import type { Forge, RepoIdentity } from "@tripwire/contracts";
import {
	type ActivityFeed,
	type ActivityFeedItem,
	type ActivityGroup,
	type ActivityRunSummary,
	type ActivityTimelineEntry,
	bearsVerdict,
	changeRequestAuthor,
	changeRequestPayloadSchema,
	type NormalizedEvent,
	normalizedEventSchema,
	type RepoScopedEvent,
	storedJsonValueSchema,
	storedNormalizedEventSchema,
	verdictEventKindSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import type { PgBoss, SendOptions } from "pg-boss";
import { z } from "zod";
import type { Db } from "../client.ts";
import {
	EVALUATE_LANES_PER_INSTALLATION,
	GITHUB_EVALUATE_QUEUE,
	type GithubEvaluateJob,
	PROCESS_EVENT_QUEUE,
} from "../queue.ts";
import { events } from "../schema/events.ts";

export interface InsertRawEventInput {
	deliveryId: string;
	rawKind: string;
	raw: unknown;
	/** Which forge sent this. Defaults to "github". The worker uses it to pick
	 *  the adapter. See the `forge` column on the events table.
	 *  Typed from the catalog, never a hand-written union — a literal list here
	 *  silently rejects a newly live forge at the ingest boundary. */
	forge?: Forge;
	/**
	 * Normalized at ingest; `null` when it normalizes to nothing Tripwire acts
	 * on, so nothing is stored. Omitted, the worker normalizes it.
	 */
	normalized?: NormalizedEvent | null;
}

/**
 * Where an event goes after it is stored:
 * - `evaluate`: it can produce a run, so it queues on `github-evaluate`.
 * - `record`: stored normalized with no job. Arm-time backfill, rule previews
 *   and the activity feed read it from the table.
 * - `process`: the worker decides, as it did for every event before lanes.
 */
export type EventLane = "evaluate" | "record" | "process";

/**
 * Why ingest stored nothing:
 * - `no-action`: it normalizes to nothing Tripwire acts on (bot or label-only
 *   PR edits).
 * - `unlinked-installation`: no org has claimed the installation, so no one
 *   can see or arm the repo.
 * - `removed-repo`: the repo was disconnected from Tripwire.
 * - `unwatched`: nothing reads this kind of event for this repo.
 */
export type IngestDropReason =
	| "no-action"
	| "unlinked-installation"
	| "removed-repo"
	| "unwatched";

export interface InsertRawEventResult {
	/** false ⇒ redelivery; UNIQUE(forge, delivery_id) made it a no-op (§5.3). */
	inserted: boolean;
	eventId: string | null;
	lane: EventLane | null;
	/** Set when nothing reads the event, so nothing was stored. */
	dropped: IngestDropReason | null;
}

type EventRoute = { lane: EventLane } | { drop: IngestDropReason };

/**
 * §5.2 — ONE transaction: insert the raw event AND its job. The pg-boss insert
 * runs on the same tx client, so there is never a job without a row. Redelivery
 * (delivery_id conflict) inserts nothing and enqueues nothing.
 *
 * Only events something reads are stored, and only events that can produce a
 * run get a job. In one staging week, 99.9% of GitHub events came from
 * installations no org had claimed; earlier, the worker spent 17 hours on 15k
 * events for repos with Tripwire off while new PRs waited behind.
 */
export async function insertRawEvent(
	pool: Pool,
	boss: PgBoss,
	input: InsertRawEventInput,
): Promise<InsertRawEventResult> {
	const client = await pool.connect();
	try {
		const id = generateId();
		const forge = input.forge ?? "github";
		const normalized = input.normalized
			? normalizedEventSchema.parse(input.normalized)
			: null;
		const route: EventRoute = normalized
			? await routeEvent(client, normalized)
			: input.normalized === null
				? { drop: "no-action" }
				: { lane: "process" };
		if ("drop" in route)
			return {
				inserted: false,
				eventId: null,
				lane: null,
				dropped: route.drop,
			};
		const { lane } = route;
		await client.query("BEGIN");
		const columns =
			normalized && lane !== "process" ? normalizedColumns(normalized) : null;
		const res = await client.query<{ id: string }>(
			`INSERT INTO events (id, delivery_id, raw_kind, raw, forge, kind,
			   repo_full_name, actor_login, subject_number, head_sha, normalized,
			   normalized_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
			   CASE WHEN $11::jsonb IS NULL THEN NULL ELSE now() END)
			 ON CONFLICT DO NOTHING
			 RETURNING id`,
			[
				id,
				input.deliveryId,
				input.rawKind,
				JSON.stringify(input.raw),
				forge,
				columns?.kind ?? null,
				columns?.repoFullName ?? null,
				columns?.actorLogin ?? null,
				columns?.subjectNumber ?? null,
				columns?.headSha ?? null,
				columns ? JSON.stringify(columns.normalized) : null,
			],
		);
		const inserted = res.rowCount === 1;
		if (inserted) {
			const db = {
				executeSql: (text: string, values?: unknown[]) =>
					client.query(text, values),
			};
			if (lane === "process")
				await boss.insert(PROCESS_EVENT_QUEUE, [{ data: { eventId: id } }], {
					db,
				});
			else if (lane === "evaluate" && normalized && "repo" in normalized)
				// send, not insert: pg-boss 12.26's insert() drops `group`.
				await boss.send(
					GITHUB_EVALUATE_QUEUE,
					{ eventId: id } satisfies GithubEvaluateJob,
					{ ...githubEvaluateOptions(normalized), db },
				);
			if (columns) {
				// Delivered on commit, like the worker's notify after normalizing.
				await client.query("SELECT pg_notify('events', $1)", [id]);
				// Nothing will run, so the feed can show the event as settled now.
				if (lane === "record")
					await client.query("SELECT pg_notify('runs', $1)", [id]);
			}
		}
		await client.query("COMMIT");
		return {
			inserted,
			eventId: inserted ? id : null,
			lane: inserted ? lane : null,
			dropped: null,
		};
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Decides, before anything is stored, whether anything will read the event:
 * - Installation events always go to the worker: they sync repos, and claiming
 *   an installation reads them.
 * - Armed repos: everything evaluates, except pushes no enabled workflow
 *   triggers on. Tripwire's own comments are recorded for the activity
 *   timeline, since the worker skips them.
 * - Repos with Tripwire off keep only the PR lifecycle, which arm-time
 *   backfill, rule previews and the onboarding PR picker read (30 days back).
 *   A close evaluates, since it settles the PR's open reviews.
 * - With no repo row, PR lifecycle events go to the worker, which adds the
 *   repo (new repos in "all repositories" installs arrive this way).
 * - Nothing is kept for installations no org has claimed, or for repos
 *   disconnected from Tripwire: the worker would revive a disconnected repo.
 */
async function routeEvent(
	client: PoolClient,
	event: NormalizedEvent,
): Promise<EventRoute> {
	if (!("repo" in event) || event.kind === "schedule.matched")
		return { lane: "process" };
	const lifecycle =
		event.kind === "change-request.opened" ||
		event.kind === "change-request.updated" ||
		event.kind === "change-request.closed";
	const found = await client.query<{
		armed: boolean;
		linked: boolean;
		removed: boolean;
		triggered: boolean;
	}>(
		`SELECT r.armed, r.org_id IS NOT NULL AS linked,
		   r.removed_at IS NOT NULL AS removed,
		   EXISTS (SELECT 1 FROM workflow_definitions w
		     WHERE w.repo_id = r.id AND w.enabled AND jsonb_path_exists(w.definition,
		       '$.nodes[*] ? (@.type == "trigger" && @.kinds[*] == $kind)',
		       jsonb_build_object('kind', $3::text))) AS triggered
		 FROM repos r WHERE r.forge = $1 AND r.full_name = $2
		 ORDER BY r.removed_at IS NOT NULL LIMIT 1`,
		[event.forge, event.repo.fullName, event.kind],
	);
	const repo = found.rows[0];
	if (!repo) {
		if (!(await installationLinked(client, event)))
			return { drop: "unlinked-installation" };
		return lifecycle ? { lane: "process" } : { drop: "unwatched" };
	}
	if (repo.removed) return { drop: "removed-repo" };
	if (repo.armed) {
		if (event.kind === "push" && !repo.triggered) return { drop: "unwatched" };
		if (event.kind === "comment.created" && event.comment.byTripwire)
			return { lane: "record" };
		return { lane: "evaluate" };
	}
	if (!repo.linked) return { drop: "unlinked-installation" };
	if (event.kind === "change-request.closed") return { lane: "evaluate" };
	return lifecycle ? { lane: "record" } : { drop: "unwatched" };
}

async function installationLinked(
	client: PoolClient,
	event: RepoScopedEvent,
): Promise<boolean> {
	if (!event.installationExternalId) return false;
	const linked = await client.query(
		"SELECT 1 FROM organization_installations WHERE forge = $1 AND installation_id = $2",
		[event.forge, event.installationExternalId],
	);
	return (linked.rowCount ?? 0) > 0;
}

/** Same subject, same lane: its events run one at a time, in order. */
export function githubEvaluateOptions(event: RepoScopedEvent): SendOptions {
	const subject = `${event.repo.fullName}#${eventSubjectNumber(event) ?? event.kind}`;
	const owner = event.installationExternalId ?? event.repo.fullName;
	return {
		priority: evaluatePriority(event.kind),
		group: {
			id: `${event.forge}:${owner}:${evaluateLane(subject)}`,
		},
	};
}

/**
 * Lane priority, highest first, when the queue backs up. Every change-request
 * kind shares one priority so a close never jumps ahead of the open or push
 * it follows in the same lane.
 */
function evaluatePriority(kind: NormalizedEvent["kind"]): number {
	switch (kind) {
		case "change-request.opened":
		case "change-request.updated":
		case "change-request.closed":
			return 10;
		case "issue.opened":
			return 5;
		case "comment.created":
			return 2;
		default:
			return 0;
	}
}

/** FNV-1a: stable across processes and deploys, unlike a random assignment. */
function evaluateLane(subject: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < subject.length; i++) {
		hash ^= subject.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) % EVALUATE_LANES_PER_INSTALLATION;
}

function eventSubjectNumber(valid: NormalizedEvent): number | null {
	return "changeRequest" in valid
		? valid.changeRequest.number
		: "comment" in valid
			? valid.comment.subjectNumber
			: "thread" in valid
				? valid.thread.number
				: valid.kind === "issue.opened"
					? valid.issue.number
					: null;
}

function normalizedColumns(valid: NormalizedEvent) {
	return {
		kind: valid.kind,
		repoFullName: "repo" in valid ? valid.repo.fullName : null,
		actorLogin: valid.actor.login,
		subjectNumber: eventSubjectNumber(valid),
		headSha:
			"changeRequest" in valid
				? valid.changeRequest.headSha
				: "push" in valid
					? valid.push.headSha
					: null,
		normalized: valid,
	};
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
	const updated = await db
		.update(events)
		.set({
			...normalizedColumns(valid),
			normalizedAt: new Date(),
		})
		.where(and(eq(events.id, eventId), eq(events.forge, valid.forge)))
		.returning({ id: events.id });
	if (updated.length !== 1) {
		throw new Error("normalized event forge does not match the stored event");
	}
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
 * The change request's most recent evaluatable event — what a manual re-run
 * evaluates. Opened/updated only: a re-run gates the change itself, not a
 * comment thread; closed carries no head to gate.
 */
export async function getLatestChangeRequestEvent(
	db: Db,
	repo: RepoIdentity,
	subjectNumber: number,
) {
	const rows = await db
		.select()
		.from(events)
		.where(
			and(
				eq(events.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
				eq(events.subjectNumber, subjectNumber),
				isNotNull(events.normalizedAt),
				inArray(events.kind, [
					"change-request.opened",
					"change-request.updated",
				]),
			),
		)
		.orderBy(desc(events.id))
		.limit(1);
	return rows[0] ?? null;
}

export async function changeRequestIsClosed(
	db: Db,
	repo: RepoIdentity,
	subjectNumber: number,
): Promise<boolean> {
	const rows = await db
		.select({ kind: events.kind })
		.from(events)
		.where(
			and(
				eq(events.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
				eq(events.subjectNumber, subjectNumber),
				isNotNull(events.normalizedAt),
				inArray(events.kind, [
					"change-request.opened",
					"change-request.updated",
					"change-request.closed",
				]),
			),
		)
		.orderBy(desc(events.id))
		.limit(1);
	return rows[0]?.kind === "change-request.closed";
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

const activityRowSchema = z.object({
	event_id: z.string(),
	event_kind: z.string().nullable(),
	normalized: storedJsonValueSchema,
	run_id: z.string().nullable(),
	verdict: z.string().nullable(),
	status: z.string().nullable(),
	reason: z.string().nullable(),
	failing_rule_id: z.string().nullable(),
	repo_full_name: z.string().optional(),
	subject_number: z.number().int().optional(),
	received_at: z.union([z.date(), z.string()]).pipe(z.coerce.date()).optional(),
});
type ActivityRow = z.infer<typeof activityRowSchema>;
const timedActivityRowSchema = activityRowSchema.required({
	received_at: true,
});
const groupedActivityRowSchema = timedActivityRowSchema.required({
	repo_full_name: true,
	subject_number: true,
});
type GroupedActivityRow = z.infer<typeof groupedActivityRowSchema>;

function leadingReason(row: ActivityRow): string | null {
	return (
		row.reason ||
		(row.failing_rule_id ? `${row.failing_rule_id.split("@")[0]} failed` : null)
	);
}

function mapRun(row: ActivityRow): ActivityRunSummary | null {
	if (row.run_id === null) return null;
	return {
		runId: row.run_id,
		verdict: row.verdict,
		status: row.status ?? "running",
		reason: leadingReason(row),
	};
}

function mapEntry(row: ActivityRow): ActivityTimelineEntry {
	const parsed = storedNormalizedEventSchema.safeParse(row.normalized);
	const run = mapRun(row);
	const pending =
		run != null &&
		run.verdict == null &&
		(run.status === "queued" || run.status === "running");
	return {
		eventId: row.event_id,
		event: parsed.success ? parsed.data : null,
		unavailableReason: parsed.success
			? undefined
			: "Historical event data is unavailable",
		run,
		pending: pending || undefined,
	};
}

/**
 * Latest run for the event. Manual re-run creates a SECOND run on the same
 * event_id; a plain JOIN picks an arbitrary row and the feed freezes on the
 * original pass. Order by created_at (UUIDv7 id breaks ties).
 */
const LATEST_RUN_LATERAL = sql`
	LEFT JOIN LATERAL (
		SELECT r.id, r.verdict, r.status
		FROM runs r
		WHERE r.event_id = e.id
		ORDER BY r.created_at DESC, r.id DESC
		LIMIT 1
	) r ON true
	LEFT JOIN LATERAL (
		SELECT s.summary, s.rule_id FROM run_steps s
		WHERE s.run_id = r.id AND s.node_kind = 'rule' AND s.status = 'fail'
		ORDER BY s.started_at ASC LIMIT 1
	) fr ON true
`;

const ACTIVITY_FROM = sql`
	FROM events e
	${LATEST_RUN_LATERAL}
`;

/**
 * The /activity feed (§9): cursor-paginated normalized events, each joined to
 * its LATEST run (verdict + status) and the first failing rule's one-liner.
 * UUIDv7 event ids are the cursor. Re-runs share an event_id with the original
 * evaluation — the lateral picks the newest run so the card moves.
 */
export async function listActivity(
	db: Db,
	{ cursor, limit = 50 }: { cursor?: string; limit?: number } = {},
): Promise<{ items: ActivityTimelineEntry[]; nextCursor: string | null }> {
	const result = await db.execute(sql`
		SELECT e.id AS event_id, e.kind AS event_kind, e.normalized, r.id AS run_id, r.verdict,
		       r.status, fr.summary AS reason, fr.rule_id AS failing_rule_id
		${ACTIVITY_FROM}
		WHERE e.normalized_at IS NOT NULL
		  ${cursor ? sql`AND e.id < ${cursor}` : sql``}
		ORDER BY e.id DESC
		LIMIT ${limit}
	`);
	const rows = result.rows.map((row) => activityRowSchema.parse(row));
	return {
		items: rows.map(mapEntry),
		nextCursor: rows.length === limit ? (rows.at(-1)?.event_id ?? null) : null,
	};
}

/** One activity row by event id — the live-resolve fetch after a run NOTIFY. */
export async function getActivityForEvent(
	db: Db,
	eventId: string,
): Promise<ActivityTimelineEntry | null> {
	const result = await db.execute(sql`
		SELECT e.id AS event_id, e.kind AS event_kind, e.normalized, r.id AS run_id, r.verdict, r.status,
		       fr.summary AS reason, fr.rule_id AS failing_rule_id
		${ACTIVITY_FROM}
		WHERE e.id = ${eventId}
		LIMIT 1
	`);
	const row = result.rows[0];
	return row ? mapEntry(activityRowSchema.parse(row)) : null;
}

/**
 * §4 arm-time backfill corpus — the LATEST normalized change-request event per
 * change request, within the window, most-recent first, capped. One event per
 * change request (its current head ⇒ one run reflecting where it stands now);
 * a comment/push event produces no run under the default workflow so they're
 * excluded. The cap bounds the arm-time burst of forge reads.
 */
export async function listBackfillEvents(
	db: Db,
	repo: RepoIdentity & { externalId?: string },
	sinceDays: number,
	cap: number,
): Promise<{ id: string; normalized: NormalizedEvent }[]> {
	const result = await db.execute(sql`
		SELECT id, normalized FROM (
			SELECT DISTINCT ON (subject_number) id, normalized, received_at
			FROM events
			WHERE forge = ${repo.forge} AND repo_full_name = ${repo.fullName}
			  AND (${repo.forge} <> 'gitcafe' OR normalized->>'repoExternalId' = ${repo.externalId ?? null})
			  AND normalized IS NOT NULL
			  AND subject_number IS NOT NULL
			  AND normalized ? 'changeRequest'
			  AND received_at > now() - make_interval(days => ${sinceDays})
			ORDER BY subject_number, received_at DESC
		) latest
		WHERE NOT EXISTS (SELECT 1 FROM runs r WHERE r.event_id = latest.id)
		ORDER BY received_at DESC
		LIMIT ${cap}
	`);
	const out: { id: string; normalized: NormalizedEvent }[] = [];
	for (const raw of result.rows) {
		const row = z
			.object({ id: z.string(), normalized: storedJsonValueSchema })
			.parse(raw);
		const parsed = normalizedEventSchema.safeParse(row.normalized);
		if (parsed.success) {
			out.push({ id: row.id, normalized: parsed.data });
		}
	}
	return out;
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
function eventUrl(event: NormalizedEvent): string | null {
	if (
		event.kind === "change-request.opened" ||
		event.kind === "change-request.updated" ||
		event.kind === "change-request.closed"
	) {
		return event.changeRequest.url;
	}
	if (event.kind === "issue.opened") {
		return event.issue.url;
	}
	if (event.kind === "comment.created") {
		return event.comment.url;
	}
	return null;
}

function isTripwireComment(event: NormalizedEvent | null): boolean {
	return event?.kind === "comment.created" && event.comment.byTripwire === true;
}

/** Tripwire's own comment is ONE upserted artifact (§7): create + edits collapse
 * to a single timeline entry, so the group shows "commented on #1" once, not
 * three identical rows. Keep the latest occurrence. */
function dedupeTripwireComments(
	timeline: ActivityTimelineEntry[],
): ActivityTimelineEntry[] {
	const lastOursIdx = timeline.reduce(
		(acc, entry, i) => (isTripwireComment(entry.event) ? i : acc),
		-1,
	);
	return timeline.filter(
		(entry, i) => !isTripwireComment(entry.event) || i === lastOursIdx,
	);
}

const historicalTitleSchema = z.object({
	kind: verdictEventKindSchema,
	changeRequest: changeRequestPayloadSchema.pick({ title: true }),
});

function buildGroup(rows: GroupedActivityRow[]): ActivityGroup {
	const chrono = [...rows].sort(
		(a, b) => a.received_at.getTime() - b.received_at.getTime(),
	);
	const timeline = dedupeTripwireComments(chrono.map(mapEntry));
	const events = timeline.flatMap((entry) =>
		entry.event ? [entry.event] : [],
	);
	const latest = chrono.at(-1);
	if (!latest) {
		throw new Error("buildGroup called with no rows");
	}
	const header = events.at(-1);
	const issue = events.find((event) => event.kind === "issue.opened");
	// Header identity: the most recent change-request event carries the title.
	const cr = [...events]
		.reverse()
		.find(
			(event) =>
				event.kind === "change-request.opened" ||
				event.kind === "change-request.updated" ||
				event.kind === "change-request.closed",
		);
	// Current verdict = the verdict of the latest event that produced a run.
	const withRun = [...chrono]
		.reverse()
		.find(
			(row) =>
				row.run_id != null &&
				bearsVerdict(mapEntry(row).event?.kind ?? row.event_kind),
		);
	const subjectNumber = latest.subject_number;
	const historicalTitle = [...chrono].reverse().flatMap((row) => {
		const parsed = historicalTitleSchema.safeParse(row.normalized);
		return parsed.success ? [parsed.data.changeRequest.title] : [];
	})[0];
	return {
		repoFullName: latest.repo_full_name,
		subjectNumber,
		title: cr
			? cr.changeRequest.title
			: (issue?.issue.title ?? historicalTitle ?? `#${subjectNumber}`),
		url: cr
			? eventUrl(cr)
			: (issue?.issue.url ?? (header ? eventUrl(header) : null)),
		actor: changeRequestAuthor(events),
		currentVerdict: withRun ? withRun.verdict : null,
		currentRunId: withRun ? withRun.run_id : null,
		latestActivityAt: latest.received_at.toISOString(),
		eventCount: rows.length,
		timeline,
	};
}

export async function listActivityFeed(
	db: Db,
	{ repo, limit = 50 }: { repo: RepoIdentity; limit?: number },
): Promise<ActivityFeed> {
	const grouped = await db.execute(sql`
		WITH grp AS (
			SELECT repo_full_name, subject_number, max(received_at) AS latest_at
			FROM events
			WHERE normalized_at IS NOT NULL AND subject_number IS NOT NULL
			  AND forge = ${repo.forge} AND repo_full_name = ${repo.fullName}
			GROUP BY repo_full_name, subject_number
			ORDER BY latest_at DESC
			LIMIT ${limit}
		)
		SELECT e.id AS event_id, e.kind AS event_kind, e.normalized, e.repo_full_name, e.subject_number, e.received_at,
		       r.id AS run_id, r.verdict, r.status, fr.summary AS reason,
		       fr.rule_id AS failing_rule_id
		FROM grp g
		JOIN events e ON e.forge = ${repo.forge} AND e.repo_full_name = g.repo_full_name
		            AND e.subject_number = g.subject_number
		            AND e.normalized_at IS NOT NULL
		LEFT JOIN LATERAL (
			SELECT lr.id, lr.verdict, lr.status
			FROM runs lr
			WHERE lr.event_id = e.id
			ORDER BY lr.created_at DESC, lr.id DESC
			LIMIT 1
		) r ON true
		LEFT JOIN LATERAL (
			SELECT s.summary, s.rule_id FROM run_steps s
			WHERE s.run_id = r.id AND s.node_kind = 'rule' AND s.status = 'fail'
			ORDER BY s.started_at ASC LIMIT 1
		) fr ON true
	`);
	const byKey = new Map<string, GroupedActivityRow[]>();
	for (const raw of grouped.rows) {
		const row = groupedActivityRowSchema.parse(raw);
		const key = `${String(row.repo_full_name)}#${Number(row.subject_number)}`;
		const bucket = byKey.get(key);
		if (bucket) {
			bucket.push(row);
		} else {
			byKey.set(key, [row]);
		}
	}
	const groups = [...byKey.values()].map(buildGroup);

	// Standalone rows for THIS repo (e.g. a push with no change request).
	// Account-level installation events carry no repo and are out of scope.
	const loose = await db.execute(sql`
		SELECT e.id AS event_id, e.kind AS event_kind, e.normalized, r.id AS run_id, r.verdict, r.status, fr.summary AS reason,
		       fr.rule_id AS failing_rule_id, e.received_at
		${ACTIVITY_FROM}
		WHERE e.normalized_at IS NOT NULL AND e.subject_number IS NULL
		  AND e.forge = ${repo.forge} AND e.repo_full_name = ${repo.fullName}
		ORDER BY e.id DESC
		LIMIT ${limit}
	`);
	const standalone = loose.rows.map((raw) => {
		const row = timedActivityRowSchema.parse(raw);
		return {
			type: "event" as const,
			entry: mapEntry(row),
			at: row.received_at.getTime(),
		};
	});

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

/**
 * Nothing reads a GitHub event past 30 days unless a run points at it:
 * backfill, rule previews and the onboarding picker look back 30 days, and
 * runs keep their event for the run page. Installation events are kept since
 * claiming an installation reads them at any age, and quarantined ones are
 * fixture candidates.
 */
export const MIN_EVENT_RETENTION_DAYS = 30;

/**
 * Deletes GitHub events older than `olderThanDays` that nothing reads, oldest
 * first, `batchSize` rows per statement so no delete holds locks for long.
 * Stops after `maxBatches`; the next run picks up the rest.
 */
export async function pruneEvents(
	db: Db,
	options: { olderThanDays: number; batchSize?: number; maxBatches?: number },
): Promise<number> {
	const days = Math.max(options.olderThanDays, MIN_EVENT_RETENTION_DAYS);
	const batchSize = options.batchSize ?? 5_000;
	let removed = 0;
	for (let batch = 0; batch < (options.maxBatches ?? 200); batch++) {
		const result = await db.execute(sql`
			DELETE FROM events WHERE id IN (
				SELECT e.id FROM events e
				WHERE e.received_at < now() - make_interval(days => ${days})
				  AND e.forge = 'github'
				  AND e.raw_kind NOT IN ('installation', 'installation_repositories')
				  AND NOT e.quarantined
				  AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.event_id = e.id)
				ORDER BY e.received_at
				LIMIT ${batchSize})
			RETURNING id
		`);
		const deleted = result.rows.length;
		removed += deleted;
		if (deleted < batchSize) break;
	}
	return removed;
}
