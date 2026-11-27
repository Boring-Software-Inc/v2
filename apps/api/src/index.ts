import { captureException, captureMessage } from "@sentry/bun";
import {
	type Auth,
	createAuth,
	resolveAuthPosture,
} from "@tripwire/auth/server";
import {
	createBoss,
	createDb,
	createDirectPool,
	createIngestQueues,
	gitCafeLifecycleServices,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import pino from "pino";
import type { ApiDeps, ApiEnv } from "./env.ts";
import { resolveGitCafeReceiptConfig } from "./gitcafe-receipts.ts";
import { createApiHealth } from "./health.ts";
import { stream } from "./routes/stream.ts";
import { webhooks } from "./routes/webhooks.ts";

/**
 * @tripwire/api — thin Hono head (§4): webhook ingest now, SSE with step 4.
 * Handlers are parse → service call → respond.
 */
export function createApi(deps: ApiDeps) {
	const app = new Hono<ApiEnv>();
	const { readHealth, readReadiness } = createApiHealth(deps);
	app.use("*", async (c, next) => {
		c.set("deps", deps);
		c.set("requestId", generateId());
		c.set("failureCaptured", false);
		await next();
		c.header("x-request-id", c.get("requestId"));
		if (c.res.status >= 500 && !c.get("failureCaptured")) {
			captureMessage("api request returned an internal error", {
				level: "error",
				fingerprint: ["api-internal-response", c.req.method, c.req.path],
				tags: {
					service: "api",
					method: c.req.method,
					path: c.req.path,
					status: String(c.res.status),
				},
				extra: { request_id: c.get("requestId") },
			});
		}
	});
	app.onError((error, c) => {
		if (error instanceof HTTPException && error.status < 500) {
			return error.getResponse();
		}
		const status = error instanceof HTTPException ? error.status : 500;
		c.set("failureCaptured", true);
		deps.logger.error(
			{ err: error, requestId: c.get("requestId"), status },
			"unhandled api error",
		);
		captureException(error, {
			tags: {
				service: "api",
				method: c.req.method,
				path: c.req.path,
				status: String(status),
			},
			extra: { request_id: c.get("requestId") },
		});
		return error instanceof HTTPException
			? error.getResponse()
			: c.text("Internal Server Error", 500);
	});
	app.use("/events/*", cors({ origin: deps.webOrigin, allowMethods: ["GET"] }));
	app.get("/healthz", async (c) => {
		const health = await readHealth();
		return c.json(health.body, health.status);
	});
	app.get("/readyz", async (c) => {
		const readiness = await readReadiness();
		return c.json(readiness.body, readiness.status);
	});
	app.route("/webhooks", webhooks);
	app.route("/events", stream);
	return app;
}

if (import.meta.main) {
	const logger = pino({ name: "api" });
	const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
	if (!webhookSecret) {
		logger.error("GITHUB_WEBHOOK_SECRET is not set");
		process.exit(1);
	}
	const { db, pool } = createDb();
	const directPool = createDirectPool();
	const gitCafeReceipts = resolveGitCafeReceiptConfig(process.env);
	const boss = gitCafeReceipts
		? await gitCafeLifecycleServices.createGitCafeLifecycleBoss(
				process.env.DATABASE_URL ?? "",
				logger,
			)
		: await createBoss(undefined, logger);
	// createBoss makes these too; the GitCafe boss leaves general queues alone.
	if (gitCafeReceipts) await createIngestQueues(boss);

	let auth: Auth | null = null;
	try {
		const secret = process.env.BETTER_AUTH_SECRET;
		const posture = resolveAuthPosture({
			secret,
			nodeEnv: process.env.NODE_ENV,
		});
		auth =
			posture === "enabled" && secret
				? createAuth({
						db,
						secret,
						baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
						github: null,
						opengit: null,
						// This head only verifies sessions (SSE gating) — it doesn't
						// mount /dash/*. Pass the key anyway so the shared dash()
						// isn't in missing-key mode if it's set on this service.
						infraApiKey: process.env.BETTER_AUTH_API_KEY,
					})
				: null;
	} catch (error) {
		logger.error({ error }, "auth posture check failed — refusing to boot");
		process.exit(1);
	}
	if (!auth) {
		logger.warn("dev open posture — /events/stream is ungated");
	}

	const app = createApi({
		auth,
		db,
		pool,
		directPool,
		boss,
		webhookSecret,
		gitCafeReceipts,
		webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
		logger,
	});
	const server = Bun.serve({
		/** Railway injects `PORT` per service; `API_PORT` is the local default.
		 * Each Railway service is an isolated container, so there is no PORT
		 * collision across api/web the way there is on one local host. */
		port: Number(process.env.PORT ?? process.env.API_PORT ?? 8787),
		/** SSE connections heartbeat every 15s; Bun's default 10s idle timeout
		 * would sever them between beats. */
		idleTimeout: 45,
		fetch: app.fetch,
	});
	logger.info(
		{
			port: server.port,
			service: "api",
			release: process.env.UNKEY_GIT_COMMIT_SHA ?? "unknown",
			receiptAdmissionEnabled: Boolean(gitCafeReceipts),
			expectedAppId: gitCafeReceipts?.appId,
			sentryConfigured: Boolean(process.env.SENTRY_DSN),
		},
		"api listening",
	);
}
