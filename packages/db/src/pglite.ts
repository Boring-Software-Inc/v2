import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client.ts";
import * as schema from "./schema/index.ts";

/**
 * PGlite — an embedded, in-process Postgres (WASM), for `dev:demo` (§13): the
 * web head with NO Docker, NO worker, NO queue. It runs the SAME Drizzle schema
 * and the SAME generated migrations as prod (one dialect, no drift) — SQLite was
 * rejected precisely because it would fork the read path. See DECISIONS.md.
 */

const MIGRATIONS_FOLDER = new URL("../drizzle", import.meta.url).pathname;

export interface PgliteHandle {
	db: Db;
	client: PGlite;
}

/**
 * Open (or create) a PGlite database at `dataDir` (omit for in-memory). The
 * returned `db` is the drizzle instance the service layer consumes: PGlite is
 * the pg dialect and API-compatible with our node-postgres `Db`, so one
 * documented cast keeps `Db` single-driver rather than widening the shared type
 * across the whole services package.
 */
export function createPgliteDb(dataDir?: string): PgliteHandle {
	if (dataDir) {
		// PGlite's NodeFS creates only the leaf dir, not parents — ensure the
		// full path exists first (e.g. `.demo/pgdata`).
		mkdirSync(dataDir, { recursive: true });
	}
	const client = new PGlite(dataDir);
	const db = drizzle(client, { schema }) as unknown as Db;
	return { db, client };
}

/** Apply the same generated migrations prod uses, via PGlite's migrator. */
export async function applyPgliteMigrations(client: PGlite): Promise<void> {
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
