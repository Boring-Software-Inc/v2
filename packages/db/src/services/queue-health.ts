import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../client.ts";
import {
	GITHUB_EVALUATE_DEAD_LETTER_QUEUE,
	GITHUB_EVALUATE_QUEUE,
	PROCESS_EVENT_QUEUE,
} from "../queue.ts";

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

const queueHealthSchema = z.object({
	evaluateReady: z.coerce.number(),
	evaluateAgeSeconds: z.coerce.number(),
	processReady: z.coerce.number(),
	processAgeSeconds: z.coerce.number(),
	deadLetteredLastDay: z.coerce.number(),
	/** null when no GitHub worker has ever run against this database. */
	workerHeartbeatAgeSeconds: z.coerce.number().nullable(),
});

export type QueueHealth = z.infer<typeof queueHealthSchema>;

/** One read of everything the queue alerts look at. */
export async function readQueueHealth(db: Db): Promise<QueueHealth> {
	const result = await db.execute(sql`
		WITH ready AS (
			SELECT name, count(*) AS n,
				COALESCE(EXTRACT(EPOCH FROM now() - min(start_after)), 0) AS age
			FROM pgboss.job
			WHERE name IN (${GITHUB_EVALUATE_QUEUE}, ${PROCESS_EVENT_QUEUE})
				AND state IN ('created', 'retry')
				AND start_after <= now()
			GROUP BY name
		)
		SELECT
			COALESCE((SELECT n FROM ready WHERE name = ${GITHUB_EVALUATE_QUEUE}), 0) AS "evaluateReady",
			COALESCE((SELECT age FROM ready WHERE name = ${GITHUB_EVALUATE_QUEUE}), 0) AS "evaluateAgeSeconds",
			COALESCE((SELECT n FROM ready WHERE name = ${PROCESS_EVENT_QUEUE}), 0) AS "processReady",
			COALESCE((SELECT age FROM ready WHERE name = ${PROCESS_EVENT_QUEUE}), 0) AS "processAgeSeconds",
			(SELECT count(*) FROM pgboss.job
				WHERE name = ${GITHUB_EVALUATE_DEAD_LETTER_QUEUE}
					AND created_on > now() - interval '1 day') AS "deadLetteredLastDay",
			(SELECT GREATEST(0, EXTRACT(EPOCH FROM now() - max(last_heartbeat_at)))
				FROM worker_deployments) AS "workerHeartbeatAgeSeconds"
	`);
	return queueHealthSchema.parse(result.rows[0]);
}

const transitionSchema = z.object({
	firing: z.boolean(),
	previousChangedAt: z.coerce.date().nullable(),
});

/**
 * Records whether an alert is firing. Returns the change when this call is
 * the one that flipped it, and null when it was already in that state, so
 * of several api replicas sampling at once exactly one posts. A first sample
 * that is clear records quietly.
 */
export async function recordAlertState(
	db: Db,
	key: string,
	firing: boolean,
): Promise<{ firing: boolean; sinceSeconds: number | null } | null> {
	const result = await db.execute(sql`
		WITH previous AS (SELECT changed_at FROM ops_alerts WHERE key = ${key})
		INSERT INTO ops_alerts (key, firing, changed_at)
		VALUES (${key}, ${firing}, now())
		ON CONFLICT (key) DO UPDATE
			SET firing = EXCLUDED.firing, changed_at = now()
			WHERE ops_alerts.firing IS DISTINCT FROM EXCLUDED.firing
		RETURNING firing, (SELECT changed_at FROM previous) AS "previousChangedAt"
	`);
	const row = result.rows[0];
	if (!row) return null;
	const change = transitionSchema.parse(row);
	// A new key that starts clear is not news.
	if (!change.firing && change.previousChangedAt === null) return null;
	return {
		firing: change.firing,
		sinceSeconds: change.previousChangedAt
			? Math.max(0, (Date.now() - change.previousChangedAt.getTime()) / 1000)
			: null,
	};
}
