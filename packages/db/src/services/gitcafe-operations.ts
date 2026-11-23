import {
	GITCAFE_LIFECYCLE_QUEUE,
	GITCAFE_PROCESS_EVENT_EXPIRE_SECONDS,
	GITCAFE_PROCESS_EVENT_QUEUE,
	GITCAFE_STALL_REPORT_INTERVAL_SECONDS,
	type GitCafeOperationalSummary,
	gitCafeOperationalSummarySchema,
} from "@tripwire/contracts";
import { type Db, requirePostgresPool } from "../client.ts";

export interface GitCafeStalledEvent {
	id: string;
	deliveryId: string;
	rawKind: string;
	receivedAt: Date;
	recoveryAttempts: number;
}

export async function claimStalledGitCafeEvents(
	db: Db,
): Promise<GitCafeStalledEvent[]> {
	const client = await requirePostgresPool(db).connect();
	try {
		await client.query("BEGIN");
		await client.query("SET LOCAL statement_timeout = '3s'");
		await client.query("SET LOCAL lock_timeout = '1s'");
		const result = await client.query<{
			id: string;
			delivery_id: string;
			raw_kind: string;
			received_at: Date;
			recovery_attempts: number;
		}>(
			`WITH candidates AS (
			 SELECT id FROM events
			 WHERE forge = 'gitcafe' AND processed_at IS NULL AND NOT quarantined
			 AND received_at <= now() - make_interval(secs => $1::int)
			 AND (stall_reported_at IS NULL OR stall_reported_at <= now() - make_interval(secs => $2::int))
			 ORDER BY received_at, id LIMIT 100 FOR UPDATE SKIP LOCKED
			) UPDATE events e SET stall_reported_at = now()
			 FROM candidates c WHERE e.id = c.id
			 RETURNING e.id, e.delivery_id, e.raw_kind, e.received_at, e.recovery_attempts`,
			[
				GITCAFE_PROCESS_EVENT_EXPIRE_SECONDS,
				GITCAFE_STALL_REPORT_INTERVAL_SECONDS,
			],
		);
		await client.query("COMMIT");
		return result.rows.map((row) => ({
			id: row.id,
			deliveryId: row.delivery_id,
			rawKind: row.raw_kind,
			receivedAt: row.received_at,
			recoveryAttempts: row.recovery_attempts,
		}));
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

export async function readGitCafeOperationalSummary(
	db: Db,
): Promise<GitCafeOperationalSummary> {
	const client = await requirePostgresPool(db).connect();
	try {
		await client.query("BEGIN READ ONLY");
		await client.query("SET LOCAL statement_timeout = '3s'");
		await client.query("SET LOCAL lock_timeout = '1s'");
		const result = await client.query<{ summary: unknown }>(
			`SELECT jsonb_build_object(
			'pendingReceipts', (SELECT count(*)::int FROM gitcafe_receipts WHERE status = 'pending'),
			'dispatchedReceipts', (SELECT count(*)::int FROM gitcafe_receipts WHERE status = 'dispatched'),
			'parkedReceipts', (SELECT count(*)::int FROM gitcafe_receipts WHERE status = 'parked'),
			'unprocessedEvents', (SELECT count(*)::int FROM events WHERE forge = 'gitcafe' AND processed_at IS NULL AND NOT quarantined),
			'eventsWithoutLiveJobs', (SELECT count(*)::int FROM events e WHERE forge = 'gitcafe' AND processed_at IS NULL AND NOT quarantined AND NOT EXISTS (SELECT 1 FROM pgboss.job j WHERE j.name = $1 AND j.data->>'eventId' = e.id AND j.state IN ('created', 'retry', 'active'))),
			'oldestReceiptAgeSeconds', (SELECT CASE WHEN min(received_at) IS NULL THEN NULL ELSE greatest(0, extract(epoch FROM now() - min(received_at))) END FROM gitcafe_receipts WHERE status IN ('pending', 'dispatched')),
			'oldestEventAgeSeconds', (SELECT CASE WHEN min(received_at) IS NULL THEN NULL ELSE greatest(0, extract(epoch FROM now() - min(received_at))) END FROM events WHERE forge = 'gitcafe' AND processed_at IS NULL AND NOT quarantined),
			'oldestActionAgeSeconds', (SELECT CASE WHEN min(a.recorded_at) IS NULL THEN NULL ELSE greatest(0, extract(epoch FROM now() - min(a.recorded_at))) END FROM run_actions a JOIN runs r ON r.id = a.run_id JOIN events e ON e.id = r.event_id WHERE e.forge = 'gitcafe' AND a.status = 'recorded'),
			'heartbeatAgeSeconds', (SELECT CASE WHEN max(progress_at) IS NULL THEN NULL ELSE greatest(0, extract(epoch FROM now() - max(progress_at))) END FROM gitcafe_runtime_heartbeats WHERE mode = 'gitcafe-protection'),
			'queues', coalesce((SELECT jsonb_agg(q) FROM (SELECT state, count(*)::int AS count, greatest(0, extract(epoch FROM now() - min(created_on))) AS "oldestAgeSeconds" FROM pgboss.job WHERE (name IN ($1, $2) OR name LIKE 'gitcafe-%') AND state IN ('created', 'retry', 'active', 'failed') GROUP BY state) q), '[]'::jsonb)
		) AS summary`,
			[GITCAFE_PROCESS_EVENT_QUEUE, GITCAFE_LIFECYCLE_QUEUE],
		);
		const summary = gitCafeOperationalSummarySchema.parse(
			result.rows[0]?.summary,
		);
		await client.query("COMMIT");
		return summary;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

export async function recordGitCafeRuntimeHeartbeat(
	db: Db,
	input: { runtimeId: string; release: string },
): Promise<void> {
	const query = {
		text: `INSERT INTO gitcafe_runtime_heartbeats (runtime_id, release, mode) VALUES ($1, $2, 'gitcafe-protection') ON CONFLICT (runtime_id) DO UPDATE SET progress_at = now()`,
		values: [input.runtimeId, input.release],
		query_timeout: 3_000,
	};
	await requirePostgresPool(db).query(query);
}

export async function removeGitCafeRuntimeHeartbeat(
	db: Db,
	runtimeId: string,
): Promise<void> {
	const query = {
		text: "DELETE FROM gitcafe_runtime_heartbeats WHERE runtime_id = $1",
		values: [runtimeId],
		query_timeout: 3_000,
	};
	await requirePostgresPool(db).query(query);
}
