import {
	type Auth,
	createAuth,
	resolveAuthPosture,
} from "@tripwire/auth/server";
import { createBoss, createDb, createDirectPool } from "@tripwire/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import pino from "pino";
import type { ApiDeps, ApiEnv } from "./env.ts";
import { stream } from "./routes/stream.ts";
import { webhooks } from "./routes/webhooks.ts";

/**
 * @tripwire/api — thin Hono head (§4): webhook ingest now, SSE with step 4.
 * Handlers are parse → service call → respond.
 */
export function createApi(deps: ApiDeps) {
	const app = new Hono<ApiEnv>();
	app.use("*", async (c, next) => {
		c.set("deps", deps);
		await next();
	});
	app.use("/events/*", cors({ origin: deps.webOrigin, allowMethods: ["GET"] }));
	app.get("/healthz", (c) => c.json({ ok: true }));
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
	const boss = await createBoss();

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
	logger.info({ port: server.port }, "api listening");
}
