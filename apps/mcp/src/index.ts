import type { Forge } from "@tripwire/contracts";
import {
	createBoss,
	createDb,
	createGitCafeConnectionBoss,
} from "@tripwire/db";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";

const logger = pino({ name: "tripwire-mcp" });
const config = readConfig(process.env);
const { db, pool } = createDb();

let boss: Promise<PgBoss> | null = null;
let gitCafeBoss: Promise<PgBoss> | null = null;
const getBoss = async (forge?: Forge) => {
	if (forge === "gitcafe") {
		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl)
			throw new Error("DATABASE_URL is required for GitCafe queues");
		gitCafeBoss ??= createGitCafeConnectionBoss(databaseUrl, logger);
		try {
			return await gitCafeBoss;
		} catch (error) {
			gitCafeBoss = null;
			throw error;
		}
	}
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
