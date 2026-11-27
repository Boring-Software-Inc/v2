import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../client.ts";

const ageRowSchema = z.object({ age: z.coerce.number() });

/**
 * How long the oldest job that could run now has been waiting, in seconds;
 * 0 when none is ready. A job is ready from its `start_after`, so a retry's
 * backoff doesn't count as waiting. Reads pg-boss's table directly: its own
 * stats are cached for up to a minute.
 */
export async function oldestReadyAgeSeconds(
	db: Db,
	queue: string,
): Promise<number> {
	const result = await db.execute(sql`
		SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(start_after)), 0) AS age
		FROM pgboss.job
		WHERE name = ${queue}
			AND state IN ('created', 'retry')
			AND start_after <= now()
	`);
	return Math.max(0, ageRowSchema.parse(result.rows[0]).age);
}
