import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.ts";

/**
 * One pool per process, sized for the three heads. LISTEN/NOTIFY consumers
 * (SSE, worker) create their own dedicated `pg` Client — a pooled connection
 * cannot hold a LISTEN.
 */
export function createDb(databaseUrl = process.env.DATABASE_URL) {
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is not set");
	}
	const pool = new Pool({ connectionString: databaseUrl, max: 10 });
	return { db: drizzle(pool, { schema }), pool };
}

export type Db = ReturnType<typeof createDb>["db"];
export { schema };
