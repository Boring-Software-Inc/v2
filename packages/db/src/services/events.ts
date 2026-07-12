import {
	type NormalizedEvent,
	normalizedEventSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
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
			repoFullName: "repo" in valid ? valid.repo.fullName : null,
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

/** A normalized event joined to its run (0..1) — the /activity feed row. */
export interface ActivityRunSummary {
	runId: string;
	verdict: string | null;
	status: string;
	/** The first failing rule's plain-English one-liner (§10), when blocked. */
	reason: string | null;
}
export interface ActivityRow {
	event: NormalizedEvent;
	run: ActivityRunSummary | null;
}

interface ActivityQueryRow {
	normalized: unknown;
	run_id: string | null;
	verdict: string | null;
	status: string | null;
	reason: string | null;
}

function toActivityRow(row: ActivityQueryRow): ActivityRow {
	return {
		event: row.normalized as NormalizedEvent,
		run: row.run_id
			? {
					runId: row.run_id,
					verdict: row.verdict,
					status: row.status ?? "running",
					reason: row.reason,
				}
			: null,
	};
}

const ACTIVITY_FROM = sql`
	FROM events e
	LEFT JOIN runs r ON r.event_id = e.id
	LEFT JOIN LATERAL (
		SELECT s.summary FROM run_steps s
		WHERE s.run_id = r.id AND s.node_kind = 'rule' AND s.status = 'fail'
		ORDER BY s.started_at ASC LIMIT 1
	) fr ON true
`;

/**
 * The /activity feed (§9): cursor-paginated normalized events, each joined to
 * its run (verdict + status) and the first failing rule's one-liner. UUIDv7
 * event ids are the cursor. One run per event (§5.11 joins workflows into one).
 */
export async function listActivity(
	db: Db,
	{ cursor, limit = 50 }: { cursor?: string; limit?: number } = {},
): Promise<{ items: ActivityRow[]; nextCursor: string | null }> {
	const result = await db.execute(sql`
		SELECT e.id AS event_id, e.normalized, r.id AS run_id, r.verdict,
		       r.status, fr.summary AS reason
		${ACTIVITY_FROM}
		WHERE e.normalized_at IS NOT NULL
		  ${cursor ? sql`AND e.id < ${cursor}` : sql``}
		ORDER BY e.id DESC
		LIMIT ${limit}
	`);
	const rows = result.rows as unknown as (ActivityQueryRow & {
		event_id: string;
	})[];
	const items = rows.map(toActivityRow);
	return {
		items,
		nextCursor: rows.length === limit ? (rows.at(-1)?.event_id ?? null) : null,
	};
}

/** One activity row by event id — the live-resolve fetch after a run NOTIFY. */
export async function getActivityForEvent(
	db: Db,
	eventId: string,
): Promise<ActivityRow | null> {
	const result = await db.execute(sql`
		SELECT e.normalized, r.id AS run_id, r.verdict, r.status,
		       fr.summary AS reason
		${ACTIVITY_FROM}
		WHERE e.id = ${eventId}
		LIMIT 1
	`);
	const row = (result.rows as unknown as ActivityQueryRow[])[0];
	return row?.normalized ? toActivityRow(row) : null;
}

/**
 * The /activity feed grouped by CHANGE REQUEST (§9). The real unit is the
 * change request, not the event: "#1 fix typo" evaluated 15 times is one group,
 * not 15 rows. Grouping is done HERE (by repo + subject number) — never
 * client-side over a paged list, or a group would split across pages.
 *
 * Each group carries its timeline (events + runs, chronological), the LATEST
 * run's verdict, and the count. Events with no change request (installation,
 * push) are standalone entries. Groups and standalone entries interleave by
 * latest activity.
 */
export interface ActivityTimelineEntry {
	event: NormalizedEvent;
	run: ActivityRunSummary | null;
}
export interface ActivityGroup {
	repoFullName: string;
	subjectNumber: number;
	title: string;
	url: string | null;
	actor: { login: string; avatarUrl: string | null };
	currentVerdict: string | null;
	currentRunId: string | null;
	latestActivityAt: string;
	eventCount: number;
	timeline: ActivityTimelineEntry[];
}
export type ActivityFeedItem =
	| { type: "group"; group: ActivityGroup }
	| { type: "event"; entry: ActivityTimelineEntry };

interface GroupedQueryRow extends ActivityQueryRow {
	repo_full_name: string;
	subject_number: number;
	received_at: Date;
}

function eventUrl(event: NormalizedEvent): string | null {
	if ("changeRequest" in event) {
		return event.changeRequest.url;
	}
	if (event.kind === "comment.created") {
		return event.comment.url;
	}
	return null;
}

function buildGroup(rows: GroupedQueryRow[]): ActivityGroup {
	const chrono = [...rows].sort(
		(a, b) => a.received_at.getTime() - b.received_at.getTime(),
	);
	const timeline = chrono.map((r) => toActivityRow(r) as ActivityTimelineEntry);
	const latest = chrono.at(-1) as GroupedQueryRow;
	// Header identity: the most recent change-request event carries the title.
	const cr = [...chrono]
		.reverse()
		.map((r) => r.normalized as NormalizedEvent)
		.find((e) => "changeRequest" in e);
	const header = (latest.normalized as NormalizedEvent) ?? cr;
	// Current verdict = the verdict of the latest event that produced a run.
	const withRun = [...chrono].reverse().find((r) => r.run_id);
	return {
		repoFullName: latest.repo_full_name,
		subjectNumber: latest.subject_number,
		title:
			cr && "changeRequest" in cr
				? cr.changeRequest.title
				: `#${latest.subject_number}`,
		url: cr ? eventUrl(cr) : eventUrl(header),
		actor: {
			login: header.actor.login,
			avatarUrl: header.actor.avatarUrl ?? null,
		},
		currentVerdict: withRun?.verdict ?? null,
		currentRunId: withRun?.run_id ?? null,
		latestActivityAt: latest.received_at.toISOString(),
		eventCount: rows.length,
		timeline,
	};
}

export async function listActivityFeed(
	db: Db,
	{ limit = 50 }: { limit?: number } = {},
): Promise<{ items: ActivityFeedItem[] }> {
	const grouped = await db.execute(sql`
		WITH grp AS (
			SELECT repo_full_name, subject_number, max(received_at) AS latest_at
			FROM events
			WHERE normalized_at IS NOT NULL AND subject_number IS NOT NULL
			GROUP BY repo_full_name, subject_number
			ORDER BY latest_at DESC
			LIMIT ${limit}
		)
		SELECT e.normalized, e.repo_full_name, e.subject_number, e.received_at,
		       r.id AS run_id, r.verdict, r.status, fr.summary AS reason
		FROM grp g
		JOIN events e ON e.repo_full_name = g.repo_full_name
		            AND e.subject_number = g.subject_number
		            AND e.normalized_at IS NOT NULL
		LEFT JOIN runs r ON r.event_id = e.id
		LEFT JOIN LATERAL (
			SELECT s.summary FROM run_steps s
			WHERE s.run_id = r.id AND s.node_kind = 'rule' AND s.status = 'fail'
			ORDER BY s.started_at ASC LIMIT 1
		) fr ON true
	`);
	const byKey = new Map<string, GroupedQueryRow[]>();
	for (const row of grouped.rows as unknown as GroupedQueryRow[]) {
		const key = `${row.repo_full_name}#${row.subject_number}`;
		const bucket = byKey.get(key);
		if (bucket) {
			bucket.push(row);
		} else {
			byKey.set(key, [row]);
		}
	}
	const groups = [...byKey.values()].map(buildGroup);

	const loose = await db.execute(sql`
		SELECT e.normalized, r.id AS run_id, r.verdict, r.status, fr.summary AS reason,
		       e.received_at
		${ACTIVITY_FROM}
		WHERE e.normalized_at IS NOT NULL AND e.subject_number IS NULL
		ORDER BY e.id DESC
		LIMIT ${limit}
	`);
	const standalone = (loose.rows as unknown as GroupedQueryRow[]).map((r) => ({
		type: "event" as const,
		entry: toActivityRow(r) as ActivityTimelineEntry,
		at: r.received_at.getTime(),
	}));

	const items: (ActivityFeedItem & { at: number })[] = [
		...groups.map((group) => ({
			type: "group" as const,
			group,
			at: new Date(group.latestActivityAt).getTime(),
		})),
		...standalone,
	];
	items.sort((a, b) => b.at - a.at);
	return { items: items.map(({ at: _at, ...item }) => item) };
}
