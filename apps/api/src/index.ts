import { createBoss, createDb } from "@tripwire/db";
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
	const boss = await createBoss();
	const app = createApi({
		db,
		pool,
		boss,
		webhookSecret,
		webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
		logger,
	});
	const server = Bun.serve({
		port: Number(process.env.PORT ?? 8787),
		fetch: app.fetch,
	});
	logger.info({ port: server.port }, "api listening");
}
