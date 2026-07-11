import {
	type Auth,
	createAuth,
	createBoss,
	createDb,
	resolveAuthPosture,
} from "@tripwire/db";
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
	if (deps.auth) {
		const auth = deps.auth;
		app.use(
			"/api/auth/*",
			cors({
				origin: deps.webOrigin,
				allowMethods: ["GET", "POST"],
				credentials: true,
			}),
		);
		app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
	}
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
	const boss = await createBoss();
	const authSecret = process.env.BETTER_AUTH_SECRET;
	try {
		resolveAuthPosture({
			secret: authSecret,
			nodeEnv: process.env.NODE_ENV,
		});
	} catch (error) {
		logger.error({ error }, "auth posture check failed — refusing to boot");
		process.exit(1);
	}
	const ghClientId = process.env.GITHUB_OAUTH_CLIENT_ID;
	const ghClientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
	const auth: Auth | null = authSecret
		? createAuth({
				db,
				secret: authSecret,
				baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
				github:
					ghClientId && ghClientSecret
						? { clientId: ghClientId, clientSecret: ghClientSecret }
						: null,
			})
		: null;
	if (!auth) {
		logger.warn("BETTER_AUTH_SECRET not set — auth endpoints disabled");
	}
	const app = createApi({
		auth,
		db,
		pool,
		boss,
		webhookSecret,
		webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
		logger,
	});
	const server = Bun.serve({
		port: Number(process.env.PORT ?? 8787),
		/** SSE connections heartbeat every 15s; Bun's default 10s idle timeout
		 * would sever them between beats. */
		idleTimeout: 45,
		fetch: app.fetch,
	});
	logger.info({ port: server.port }, "api listening");
}
