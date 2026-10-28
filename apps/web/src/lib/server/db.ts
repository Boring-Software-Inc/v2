import {
	createDb,
	createGitCafeConnectionBoss,
	createPgliteDb,
	type PgliteHandle,
} from "@tripwire/db";
import type { PgBoss } from "pg-boss";
import pino from "pino";

type DbBundle = ReturnType<typeof createDb>;
type DbPool = DbBundle["pool"];

/**
 * Server-only database access for TanStack server functions. Import this
 * module ONLY inside `createServerFn` handlers (dynamic import) so pg never
 * reaches the client bundle. One pool per web server process.
 *
 * `dev:demo` (§13) sets `PGLITE_DATA_DIR` — then the head runs on an embedded
 * in-process Postgres (no Docker, no worker, no queue). Only `.db` is available
 * in that mode; there is no pg pool and no pg-boss (nothing processes jobs).
 */
let instance: DbBundle | null = null;
let boss: PgBoss | null = null;
let gitCafeConnectionBoss: Promise<PgBoss> | null = null;
let pglite: PgliteHandle["client"] | null = null;
const connectionQueueLogger = pino({ name: "gitcafe-connection-queue" });

/** `dev:demo` runs the web head alone against embedded PGlite. */
export function isDemoMode(): boolean {
	return Boolean(process.env.PGLITE_DATA_DIR);
}

// Any attempt to use a pg pool in demo mode is a bug — fail loudly, never hang.
const DEMO_POOL = new Proxy(
	{},
	{
		get() {
			throw new Error(
				"No Postgres pool in demo mode. The web app runs alone, with no worker or queue.",
			);
		},
	},
) as unknown as DbPool;

export function getDb() {
	if (instance) {
		return instance;
	}
	if (isDemoMode()) {
		const { db, client } = createPgliteDb(process.env.PGLITE_DATA_DIR);
		pglite = client;
		instance = { db, pool: DEMO_POOL };
		return instance;
	}
	instance = createDb();
	return instance;
}

/** The embedded Postgres in demo mode, for its in-process LISTEN. */
export function getPglite(): PgliteHandle["client"] | null {
	getDb();
	return pglite;
}

export async function getBoss(): Promise<PgBoss> {
	if (isDemoMode()) {
		throw new Error("pg-boss is unavailable in demo mode (no worker/queue)");
	}
	const existing = boss;
	if (existing) {
		return existing;
	}
	const { createBoss } = await import("@tripwire/db");
	const created = await createBoss();
	boss = created;
	return created;
}

export async function getGitCafeConnectionBoss(
	requestId: string,
): Promise<PgBoss> {
	if (isDemoMode())
		throw new Error("pg-boss is unavailable in demo mode (no worker/queue)");
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("DATABASE_URL is not set");
	gitCafeConnectionBoss ??= createGitCafeConnectionBoss(
		databaseUrl,
		connectionQueueLogger.child({ requestId }),
	);
	const pending = gitCafeConnectionBoss;
	try {
		return await pending;
	} catch (error) {
		if (gitCafeConnectionBoss === pending) gitCafeConnectionBoss = null;
		throw error;
	}
}
