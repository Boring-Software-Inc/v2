import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type Db } from "./client.ts";

// `fileURLToPath`, not `.pathname` — on Windows the latter yields "/C:/..." with
// a leading slash, which no fs call accepts, so every integration test failed to
// find the migrations folder.
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Applies generated migrations — shared by the CLI and integration tests. */
export async function applyMigrations(db: Db): Promise<void> {
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

if (import.meta.main) {
	const { db, pool } = createDb();
	await applyMigrations(db);
	await pool.end();
	process.stdout.write("migrations applied\n");
}
