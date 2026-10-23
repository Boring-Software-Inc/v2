import { createBoss, createDb } from "@tripwire/db";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";

const logger = pino({ name: "tripwire-mcp" });
const config = readConfig(process.env);
const { db, pool } = createDb();

let boss: Promise<PgBoss> | null = null;
const getBoss = () => {
	boss ??= createBoss(process.env.DATABASE_URL, logger).catch(
		(error: unknown) => {
			boss = null;
			throw error;
		},
	);
	return boss;
};

const app = createApp({ db, pool, getBoss, config, logger });

Bun.serve({ port: config.port, fetch: app.fetch });
logger.info(
	{ port: config.port, resource: config.resource, issuer: config.issuer },
	"tripwire mcp listening",
);
