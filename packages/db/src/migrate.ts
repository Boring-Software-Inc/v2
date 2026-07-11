import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.ts";

/** `bun db:migrate` — applies generated migrations from ./drizzle. */
const { db, pool } = createDb();
const migrationsFolder = new URL("../drizzle", import.meta.url).pathname;
await migrate(db, { migrationsFolder });
await pool.end();
process.stdout.write("migrations applied\n");
