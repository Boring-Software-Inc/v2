import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema/index.ts";

/**
 * PGlite — an embedded, in-process Postgres (WASM), for `dev:demo` (§13): the
 * web head with NO Docker, NO worker, NO queue. It runs the SAME Drizzle schema
 * and the SAME generated migrations as prod (one dialect, no drift) — SQLite was
 * rejected precisely because it would fork the read path. See DECISIONS.md.
 */

// `fileURLToPath`, not `.pathname`: on Windows the latter yields "/C:/..."
// with a leading slash, which no fs call accepts.
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export interface PgliteHandle {
	db: ReturnType<typeof drizzle<typeof schema, PGlite>>;
	client: PGlite;
}

/**
 * Open (or create) a PGlite database at `dataDir` (omit for in-memory). The
 * returned `db` retains PGlite's driver types and shares the service-layer schema.
 */
export function createPgliteDb(dataDir?: string): PgliteHandle {
	if (dataDir) {
		// PGlite's NodeFS creates only the leaf dir, not parents — ensure the
		// full path exists first (e.g. `.demo/pgdata`).
		mkdirSync(dataDir, { recursive: true });
	}
	const client = new PGlite(dataDir);
	const db = drizzle(client, { schema });
	return { db, client };
}

/** Apply the same generated migrations prod uses, via PGlite's migrator. */
export async function applyPgliteMigrations(client: PGlite): Promise<void> {
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
