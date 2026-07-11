import {
	type NormalizedEvent,
	normalizedEventSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { Db } from "../client.ts";
import { PROCESS_EVENT_QUEUE } from "../queue.ts";
import { events } from "../schema/events.ts";

export interface InsertRawEventInput {
	deliveryId: string;
	rawKind: string;
	raw: unknown;
}

export interface InsertRawEventResult {
	/** false ⇒ redelivery; UNIQUE(delivery_id) made it a no-op (§5.3). */
	inserted: boolean;
	eventId: string | null;
}

/**
 * §5.2 — ONE transaction: insert the raw event AND enqueue the process-event
 * job. The pg-boss insert runs on the same tx client, so there is never a job
 * without a row or a row without a job. Redelivery (delivery_id conflict)
 * inserts nothing and enqueues nothing.
 */
export async function insertRawEvent(
	pool: Pool,
	boss: PgBoss,
	input: InsertRawEventInput,
): Promise<InsertRawEventResult> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const id = generateId();
		const res = await client.query<{ id: string }>(
			`INSERT INTO events (id, delivery_id, raw_kind, raw)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (delivery_id) DO NOTHING
			 RETURNING id`,
			[id, input.deliveryId, input.rawKind, JSON.stringify(input.raw)],
		);
		const inserted = res.rowCount === 1;
		if (inserted) {
			await boss.insert(PROCESS_EVENT_QUEUE, [{ data: { eventId: id } }], {
				db: {
					executeSql: (text: string, values?: unknown[]) =>
						client.query(text, values),
				},
			});
		}
		await client.query("COMMIT");
		return { inserted, eventId: inserted ? id : null };
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

/**
 * §5.6 — write the normalized form onto the event row (validated on write)
 * and NOTIFY 'events' so the SSE fan-out picks it up.
 */
export async function markEventNormalized(
	db: Db,
	pool: Pool,
	eventId: string,
	normalized: NormalizedEvent,
): Promise<void> {
	const valid = normalizedEventSchema.parse(normalized);
	const subjectNumber =
		"changeRequest" in valid
			? valid.changeRequest.number
			: "comment" in valid
				? valid.comment.subjectNumber
				: null;
	const headSha =
		"changeRequest" in valid
			? valid.changeRequest.headSha
			: "push" in valid
				? valid.push.headSha
				: null;
	await db
		.update(events)
		.set({
			kind: valid.kind,
			repoFullName: valid.repo.fullName,
			actorLogin: valid.actor.login,
			subjectNumber,
			headSha,
			normalized: valid,
			normalizedAt: new Date(),
		})
		.where(eq(events.id, eventId));
	await pool.query("SELECT pg_notify('events', $1)", [eventId]);
}

/** §5.5 — parse failure ⇒ quarantine + fixture candidate (raw stays intact). */
export async function quarantineEvent(
	db: Db,
	eventId: string,
	reason: string,
): Promise<void> {
	await db
		.update(events)
		.set({ quarantined: true, quarantineReason: reason })
		.where(eq(events.id, eventId));
}

export async function getEventById(db: Db, eventId: string) {
	const rows = await db.select().from(events).where(eq(events.id, eventId));
	return rows[0] ?? null;
}

/**
 * Cursor-paginated normalized events, newest first. UUIDv7 ids are
 * time-sortable, so the id itself is the cursor.
 */
export async function listEvents(
	db: Db,
	{ cursor, limit = 50 }: { cursor?: string; limit?: number } = {},
) {
	const rows = await db
		.select()
		.from(events)
		.where(
			cursor
				? and(isNotNull(events.normalizedAt), lt(events.id, cursor))
				: isNotNull(events.normalizedAt),
		)
		.orderBy(desc(events.id))
		.limit(limit);
	return {
		items: rows,
		nextCursor: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
	};
}
