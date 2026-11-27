import type { PGlite } from "@electric-sql/pglite";
import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";
import { Pool } from "pg";
import {
	assertPooledDatabaseUrl,
	assertSessionDatabaseUrl,
} from "./database-url.ts";
import * as schema from "./schema/index.ts";

/**
 * One pool per process, sized for the three heads. LISTEN/NOTIFY consumers
 * (SSE, worker) create their own dedicated `pg` Client — a pooled connection
 * cannot hold a LISTEN.
 */
export function createDb(databaseUrl = process.env.DATABASE_URL, max = 10) {
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is not set");
	}
	assertPooledDatabaseUrl(databaseUrl);
	const pool = survivesDroppedConnections(
		new Pool({ connectionString: databaseUrl, max }),
	);
	return { db: drizzle(pool, { schema }), pool };
}

/**
 * When the database closes an idle connection (a restart, a resize, a
 * failover), `pg` emits `error` on the pool, and with no listener that throws
 * and kills the process. The pool has already dropped the dead connection
 * and opens a new one on the next query, so there is nothing else to do.
 */
function survivesDroppedConnections(pool: Pool): Pool {
	pool.on("error", (error) => {
		console.warn(`postgres dropped an idle connection: ${error.message}`);
	});
	return pool;
}

/**
 * A dedicated pool for LISTEN/NOTIFY (the SSE stream's LISTEN, the worker's
 * NOTIFY). Behind a connection pooler (PlanetScale in prod), LISTEN needs a
 * persistent SESSION — a transaction-pooled connection silently drops it and
 * the live feed dies — so these clients use `DATABASE_URL_DIRECT`, the
 * direct/session endpoint. Falls back to `DATABASE_URL` when unset, so local
 * dev (one Postgres, no pooler) is unchanged. Small `max`: a few long-lived
 * listeners plus fire-and-forget notifies.
 */
export function createDirectPool(
	directUrl = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL,
	max = 5,
) {
	if (!directUrl) {
		throw new Error("DATABASE_URL_DIRECT (or DATABASE_URL) is not set");
	}
	assertSessionDatabaseUrl(directUrl);
	return survivesDroppedConnections(
		new Pool({ connectionString: directUrl, max }),
	);
}

/** Shared schema and query surface of the two supported PostgreSQL drivers. */
export type Db = PgDatabase<
	NodePgQueryResultHKT | PgliteQueryResultHKT,
	typeof schema
> & { $client: Pool | PGlite };

/** pg-boss admission requires a real pool and the same checked-out connection. */
export function requirePostgresPool(db: Db): Pool {
	if (!(db.$client instanceof Pool)) {
		throw new Error("This operation requires a PostgreSQL connection pool");
	}
	return db.$client;
}

export { schema };
