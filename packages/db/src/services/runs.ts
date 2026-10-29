import type { Forge, RepoIdentity } from "@tripwire/contracts";
import {
	GITCAFE_VERDICT_ACTION_KINDS,
	type GitCafeEvaluationPhase,
	gitCafeActionPayloadSchema,
	gitCafeEvaluationPhaseSchema,
	HELD_VERDICTS,
	ingestForgeSchema,
	type RunStanding,
	ruleResultSchema,
	standingVerdict,
	VERDICT_EVENT_KINDS,
	type Verdict,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import {
	and,
	desc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	or,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../client.ts";
import { events } from "../schema/events.ts";
import { moderationItems } from "../schema/moderation.ts";
import { runActions, runSteps, runs } from "../schema/runs.ts";
import type { DbLike } from "./access.ts";

/**
 * Run persistence (§5.10–5.12). The workflow definition is SNAPSHOT onto the
 * run — later edits never change what a historical run page shows. Actions
 * are recorded as rows FIRST and marked executed after, so a crash mid-run
 * can never double-block on retry.
 */

const snapshotSchema = z.array(workflowDefinitionSchema).min(1);

export interface CreateRunInput {
	eventId: string;
	repoFullName: string;
	subjectNumber: number | null;
	subjectKind?: "issue" | "change-request" | null;
	headSha: string | null;
	/** Every workflow definition that fired, joined into ONE run (§5.11). */
	snapshot: WorkflowDefinition[];
	/**
	 * `queued` = materialized at re-run enqueue before the worker claims it.
	 * `running` | `paused` | `completed` | `failed` as the worker progresses.
	 */
	status: "queued" | "running" | "paused" | "completed" | "failed";
	verdict: Verdict | null;
	/** Set for manual re-runs: the triggering admin's user id. */
	triggeredBy?: string | null;
	/** Optional pre-assigned id (re-run materializes the id at enqueue). */
	id?: string;
	backfill?: boolean;
}

export async function createRun(db: DbLike, input: CreateRunInput) {
	const snapshot = snapshotSchema.parse(input.snapshot);
	const id = input.id ?? generateId();
	await db.insert(runs).values({
		id,
		eventId: input.eventId,
		repoFullName: input.repoFullName,
		subjectNumber: input.subjectNumber,
		subjectKind: input.subjectKind ?? null,
		headSha: input.headSha,
		status: input.status,
		verdict: input.verdict,
		workflowSnapshot: snapshot,
		triggeredBy: input.triggeredBy ?? null,
		backfill: input.backfill ?? false,
		completedAt: input.status === "completed" ? new Date() : null,
	});
	return id;
}

export async function getRunForEvent(db: Db, eventId: string) {
	const [run] = await db
		.select()
		.from(runs)
		.where(eq(runs.eventId, eventId))
		.limit(1);
	return run ?? null;
}

export async function isReviewCleanupComplete(
	db: Db,
	runId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ status: runActions.status })
		.from(runActions)
		.where(
			and(eq(runActions.runId, runId), eq(runActions.kind, "dismiss-review")),
		)
		.orderBy(desc(runActions.recordedAt), desc(runActions.id))
		.limit(1);
	return row?.status === "executed";
}

export interface FinalizeRunInput {
	eventId: string;
	headSha: string | null;
	snapshot: WorkflowDefinition[];
	status: "paused" | "completed" | "failed";
	verdict: Verdict | null;
}

/**
 * Claim a pre-materialized re-run row: write the real snapshot + verdict and
 * mark it terminal. Steps/actions are recorded separately against the same id.
 */
export async function finalizeRun(
	db: DbLike,
	runId: string,
	input: FinalizeRunInput,
): Promise<void> {
	const snapshot = snapshotSchema.parse(input.snapshot);
	await db
		.update(runs)
		.set({
			eventId: input.eventId,
			headSha: input.headSha,
			workflowSnapshot: snapshot,
			status: input.status,
			verdict: input.verdict,
			completedAt: new Date(),
		})
		.where(eq(runs.id, runId));
}

/**
 * Claim a pre-materialized re-run: set status running and pin the real
 * snapshot (planned rule list) so the run page can show the queue while
 * steps stream in.
 */
export async function beginRunEvaluation(
	db: Db,
	runId: string,
	input: {
		snapshot: WorkflowDefinition[];
		headSha: string | null;
		eventId: string;
	},
): Promise<void> {
	const snapshot = snapshotSchema.parse(input.snapshot);
	await db
		.update(runs)
		.set({
			status: "running",
			workflowSnapshot: snapshot,
			headSha: input.headSha,
			eventId: input.eventId,
			createdAt: new Date(),
		})
		.where(eq(runs.id, runId));
}

/** @deprecated Prefer beginRunEvaluation (writes snapshot + head). */
export async function markRunRunning(db: Db, runId: string): Promise<void> {
	await db
		.update(runs)
		.set({ status: "running" })
		.where(and(eq(runs.id, runId), eq(runs.status, "queued")));
}

/**
 * Fail a pre-materialized re-run that never evaluated (unarmed, no event,
 * exempt, worker error). Leaves the row visible so the activity card is not
 * forever-queued.
 */
export async function failRun(db: Db, runId: string): Promise<void> {
	await db
		.update(runs)
		.set({
			status: "failed",
			verdict: null,
			completedAt: new Date(),
		})
		.where(eq(runs.id, runId));
}

export async function getRunById(db: DbLike, runId: string) {
	const rows = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
	return rows[0] ?? null;
}

/**
 * Pre-materialized re-runs still `queued` past a cutoff — the web created the
 * row but no worker claimed it (undeployed consumer, boss lag). The minute
 * sweeper fails them so the activity card never says "evaluating" forever.
 */
export async function listStuckQueuedRuns(
	db: Db,
	createdBefore: Date,
	forge?: Forge,
): Promise<{ id: string; eventId: string; repoFullName: string }[]> {
	const rows = await db
		.select({
			id: runs.id,
			eventId: runs.eventId,
			repoFullName: runs.repoFullName,
		})
		.from(runs)
		.innerJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runs.status, "queued"),
				lt(runs.createdAt, createdBefore),
				forge === undefined ? undefined : eq(events.forge, forge),
			),
		);
	return rows;
}

export interface RecordStepInput {
	nodeId: string;
	nodeKind: string;
	ruleRef?: string;
	status: string;
	input: unknown;
	output: unknown;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	/** §10 public partition — computed by the worker via the rule (core). */
	publicEvidence?: unknown;
	summary?: string | null;
}

export async function recordSteps(
	db: DbLike,
	runId: string,
	steps: RecordStepInput[],
): Promise<void> {
	if (steps.length === 0) {
		return;
	}
	await db.insert(runSteps).values(
		steps.map((step) => ({
			id: generateId(),
			runId,
			nodeId: step.nodeId,
			nodeKind: step.nodeKind,
			ruleId: step.ruleRef ?? null,
			status: step.status,
			input: step.input ?? null,
			output: step.output ?? null,
			/** Rule steps: the validated RuleResult envelope IS the evidence. */
			evidence:
				step.nodeKind === "rule" && step.output
					? ruleResultSchema.parse(step.output)
					: null,
			/** §10 — the rule-projected public partition (worker-supplied). */
			publicEvidence: step.publicEvidence ?? null,
			summary: step.summary ?? null,
			startedAt: new Date(step.startedAt),
			finishedAt: new Date(step.finishedAt),
			durationMs: step.durationMs,
		})),
	);
}

export interface RecordActionInput {
	kind: string;
	payload: Record<string, unknown>;
	idempotencyKey: string;
}

export async function recordActions(
	db: DbLike,
	runId: string,
	actions: RecordActionInput[],
	/**
	 * §4 backfill — `"suppressed"` records the row for data-model parity but keeps
	 * it out of the sweeper (which only picks up `"recorded"`), so a backfilled
	 * run never posts a comment/check on a historical change request.
	 */
	initialStatus: "recorded" | "suppressed" = "recorded",
): Promise<{ id: string; kind: string; payload: Record<string, unknown> }[]> {
	if (actions.length === 0) {
		return [];
	}
	const gitCafePhase = await getGitCafeEvaluationPhase(db, runId);
	const rows = actions.map((action) => ({
		id: generateId(),
		runId,
		kind: action.kind,
		payload:
			gitCafePhase && GITCAFE_VERDICT_ACTION_KINDS.has(action.kind)
				? { ...action.payload, gitCafePhase }
				: action.payload,
		idempotencyKey: action.idempotencyKey,
		status: initialStatus,
	}));
	const inserted = await db
		.insert(runActions)
		.values(rows)
		.onConflictDoNothing({
			target: [runActions.runId, runActions.idempotencyKey],
		})
		.returning({
			id: runActions.id,
			kind: runActions.kind,
			payload: runActions.payload,
		});
	return inserted.map((row) => ({
		id: row.id,
		kind: row.kind,
		payload: row.payload as Record<string, unknown>,
	}));
}

/** One statement binds the verdict to every moderation decision already applied to it. */
export async function getGitCafeEvaluationPhase(
	db: DbLike,
	runId: string,
): Promise<GitCafeEvaluationPhase | null> {
	const result = await db.execute(sql`
		SELECT r.status, r.verdict, r.head_sha AS "headSha",
			COALESCE((SELECT jsonb_agg(m.id ORDER BY m.id) FROM moderation_items m WHERE m.run_id=r.id AND m.applied_at IS NOT NULL),'[]'::jsonb) AS "appliedItems"
		FROM runs r JOIN events e ON e.id=r.event_id
		WHERE r.id=${runId} AND e.forge='gitcafe' AND r.status IN ('paused','completed','closed')
	`);
	const parsed = gitCafeEvaluationPhaseSchema.safeParse(result.rows[0]);
	return parsed.success ? parsed.data : null;
}

/** The run lock makes the recovered audit and its phase one consistent committed view. */
export async function getGitCafeRunSurfaceState(db: Db, runId: string) {
	return db.transaction(async (tx) => {
		await tx.execute(sql`SELECT id FROM runs WHERE id=${runId} FOR UPDATE`);
		const phase = await getGitCafeEvaluationPhase(tx, runId);
		const saved = await getRunWithSteps(tx, runId);
		return phase && saved ? { phase, saved } : null;
	});
}

/** Supersession never promotes an old clearance intent into a newer evaluation phase. */
export async function recordGitCafeSurfaceActions(
	db: Db,
	runId: string,
	phase: GitCafeEvaluationPhase,
	actions: RecordActionInput[],
	pendingIds: string[],
	reviewBodies: { id: string; body: string }[],
) {
	const expected = gitCafeEvaluationPhaseSchema.parse(phase);
	return db.transaction(async (tx) => {
		await tx.execute(sql`SELECT id FROM runs WHERE id=${runId} FOR UPDATE`);
		const current = await getGitCafeEvaluationPhase(tx, runId);
		if (JSON.stringify(current) !== JSON.stringify(expected)) return null;
		const recorded = await tx
			.select()
			.from(runActions)
			.where(
				and(eq(runActions.runId, runId), eq(runActions.status, "recorded")),
			);
		const continued: RecordActionInput[] = [];
		for (const row of recorded) {
			if (!GITCAFE_VERDICT_ACTION_KINDS.has(row.kind)) continue;
			const payload = gitCafeActionPayloadSchema.parse(row.payload);
			if (JSON.stringify(payload.gitCafePhase) === JSON.stringify(expected)) {
				const review = reviewBodies.find((body) => body.id === row.id);
				if (review && !payload.gitCafeOperation)
					await stampReviewBody(tx, row.id, review.body);
				continue;
			}
			await tx
				.update(runActions)
				.set({ status: "superseded" })
				.where(eq(runActions.id, row.id));
			if (
				(row.kind === "block" || row.kind === "close") &&
				expected.verdict === row.kind &&
				pendingIds.includes(row.id)
			) {
				const body =
					payload.gitCafeOperation?.command.kind === "review"
						? payload.gitCafeOperation.command.input.body
						: reviewBodies.find((body) => body.id === row.id)?.body;
				delete payload.gitCafeOperation;
				delete payload.gitCafePhase;
				if (body !== undefined) payload.reason = body;
				continued.push({
					kind: row.kind,
					payload,
					idempotencyKey: JSON.stringify([
						"continued-action",
						row.id,
						expected,
					]),
				});
			}
		}
		return recordActions(tx, runId, [...continued, ...actions]);
	});
}

export async function markActionExecuted(
	db: Db,
	actionId: string,
	externalId: string | null,
): Promise<void> {
	await db
		.update(runActions)
		.set({ status: "executed", executedAt: new Date(), externalId })
		.where(eq(runActions.id, actionId));
}

export interface PersistRunEvaluationInput {
	run: Omit<CreateRunInput, "status"> & { status: FinalizeRunInput["status"] };
	existingRunId?: string;
	steps: RecordStepInput[];
	moderationNodeIds: string[];
	actions: RecordActionInput[];
	suppressed: boolean;
}

/** A run is reusable on recovery only after its evaluation audit and action intents commit together. */
export async function persistRunEvaluation(
	db: Db,
	input: PersistRunEvaluationInput,
) {
	return db.transaction(async (tx) => {
		const runId = input.existingRunId ?? (await createRun(tx, input.run));
		if (input.existingRunId)
			await finalizeRun(tx, runId, {
				eventId: input.run.eventId,
				headSha: input.run.headSha,
				snapshot: input.run.snapshot,
				status: input.run.status,
				verdict: input.run.verdict,
			});
		await recordSteps(tx, runId, input.steps);
		if (input.moderationNodeIds.length)
			await tx.insert(moderationItems).values(
				input.moderationNodeIds.map((nodeId) => ({
					id: generateId(),
					runId,
					nodeId,
				})),
			);
		const actionRows = await recordActions(
			tx,
			runId,
			input.actions,
			input.suppressed ? "suppressed" : "recorded",
		);
		return { runId, actionRows };
	});
}

/**
 * A recorded action that must NOT execute — its run moved on (a newer verdict
 * surface exists) or it lost comment ownership (a newer run gates the PR).
 * Same terminal status, two triggers (§6 surface sweeper + comment ownership).
 */
export async function markActionSuperseded(
	db: Db,
	actionId: string,
): Promise<void> {
	await db
		.update(runActions)
		.set({ status: "superseded" })
		.where(eq(runActions.id, actionId));
}

/**
 * Store the built delivery payload on an outbound action row. The url +
 * signing secret already live in the row (from the node params); this adds the
 * assembled webhook body so the delivery job needs no run re-derivation. The
 * whole payload stays server-side — the run view serializes only
 * {kind, status, recordedAt}, never the payload.
 */
export async function attachDeliveryPayload(
	db: Db,
	actionId: string,
	delivery: unknown,
): Promise<void> {
	const rows = await db
		.select({ payload: runActions.payload })
		.from(runActions)
		.where(eq(runActions.id, actionId));
	const current = (rows[0]?.payload ?? {}) as Record<string, unknown>;
	await db
		.update(runActions)
		.set({ payload: { ...current, delivery } })
		.where(eq(runActions.id, actionId));
}

export async function stampReviewBody(
	db: DbLike,
	actionId: string,
	reason: string,
): Promise<void> {
	await db
		.update(runActions)
		.set({
			payload: sql`${runActions.payload} || jsonb_build_object('reason', ${reason}::text)`,
		})
		.where(eq(runActions.id, actionId));
}

/**
 * Record an outbound delivery FAILURE on the row — the class (never the url) +
 * an attempt counter, so a failed delivery is observable in the run view and
 * the E2E harness without reading worker logs. The row stays `recorded` (the
 * poll retries it) until it succeeds or is abandoned.
 */
export async function recordDeliveryFailure(
	db: Db,
	actionId: string,
	failure: string,
): Promise<void> {
	const rows = await db
		.select({ payload: runActions.payload })
		.from(runActions)
		.where(eq(runActions.id, actionId));
	const current = (rows[0]?.payload ?? {}) as Record<string, unknown>;
	const attempts =
		typeof current.deliveryAttempts === "number" ? current.deliveryAttempts : 0;
	await db
		.update(runActions)
		.set({
			payload: {
				...current,
				deliveryFailure: failure,
				deliveryAttempts: attempts + 1,
			},
		})
		.where(eq(runActions.id, actionId));
}

export interface DeliverableAction {
	id: string;
	kind: string;
	payload: Record<string, unknown>;
	recordedAt: Date;
}

/**
 * Outbound-delivery rows (webhook/discord) still `recorded` — the delivery job
 * picks these up. Unlike the forge sweeper there is no age floor: deliver on
 * the next tick. `giveUpBefore` abandons rows too old to keep retrying.
 */
export async function listDeliverableActions(
	db: Db,
): Promise<DeliverableAction[]> {
	const rows = await db
		.select({
			id: runActions.id,
			kind: runActions.kind,
			payload: runActions.payload,
			recordedAt: runActions.recordedAt,
		})
		.from(runActions)
		.where(
			and(
				eq(runActions.status, "recorded"),
				inArray(runActions.kind, ["webhook", "discord"]),
			),
		);
	return rows.map((row) => ({
		...row,
		payload: row.payload as Record<string, unknown>,
	}));
}

export interface StuckAction {
	forge: Forge;
	id: string;
	runId: string;
	kind: string;
	payload: Record<string, unknown>;
	idempotencyKey: string;
	recordedAt: Date;
	runStatus: string;
	runVerdict: string | null;
	repoFullName: string;
	subjectNumber: number | null;
	headSha: string | null;
	eventKind: string | null;
}

/**
 * Surface actions still `recorded` past a cutoff — recorded-first rows whose
 * execution was blocked by a forge outage (§5.12). The sweeper re-attempts
 * them (idempotency keys make retries safe) once credentials recover.
 */
export async function listStuckActions(
	db: Db,
	recordedBefore: Date,
	forge?: Forge,
): Promise<StuckAction[]> {
	const rows = await db
		.select({
			id: runActions.id,
			forge: events.forge,
			runId: runActions.runId,
			kind: runActions.kind,
			payload: runActions.payload,
			idempotencyKey: runActions.idempotencyKey,
			recordedAt: runActions.recordedAt,
			runStatus: runs.status,
			runVerdict: runs.verdict,
			repoFullName: runs.repoFullName,
			subjectNumber: runs.subjectNumber,
			headSha: runs.headSha,
			eventKind: events.kind,
		})
		.from(runActions)
		.innerJoin(runs, eq(runActions.runId, runs.id))
		.innerJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runActions.status, "recorded"),
				forge === undefined
					? inArray(events.forge, [...ingestForgeSchema.options])
					: eq(events.forge, forge),
				lt(runActions.recordedAt, recordedBefore),
			),
		);
	return rows.map((row) => ({
		...row,
		payload: row.payload as Record<string, unknown>,
	}));
}

export async function listRunActions(
	db: Db,
	runId: string,
): Promise<{ kind: string; status: string; recordedAt: Date }[]> {
	return await db
		.select({
			kind: runActions.kind,
			status: runActions.status,
			recordedAt: runActions.recordedAt,
		})
		.from(runActions)
		.where(eq(runActions.runId, runId));
}

/**
 * The latest run gating a change request (§6 comment ownership): runs are
 * per-event/SHA but the PR comment is per-PR, so only the latest run may own
 * the comment. Latest by the triggering event's ingest order (UUIDv7), then
 * creation time, so a slow run for an older event never outranks a newer one.
 */
export const eventBearsVerdict = inArray(events.kind, [...VERDICT_EVENT_KINDS]);

export const liveRun = eq(runs.backfill, false);

export const changeRequestAuthorLogin = sql<
	string | null
>`coalesce(${events.raw} #>> '{pull_request,user,login}', ${events.actorLogin})`;

export const runBearsVerdict = sql`EXISTS (SELECT 1 FROM events ve WHERE ve.id = ${runs.eventId} AND ${inArray(sql`ve.kind`, [...VERDICT_EVENT_KINDS])})`;

export const runRecency = [
	desc(runs.eventId),
	desc(runs.createdAt),
	desc(runs.id),
] as const;

export interface LatestChangeRequestRun {
	id: string;
	eventId: string;
	headSha: string | null;
}

export async function getLatestRunIdForChangeRequest(
	db: DbLike,
	repo: RepoIdentity,
	subjectNumber: number,
): Promise<string | null> {
	return (
		(await getLatestRunForChangeRequest(db, repo, subjectNumber))?.id ?? null
	);
}

export async function getLatestRunForChangeRequest(
	db: DbLike,
	repo: RepoIdentity,
	subjectNumber: number,
): Promise<LatestChangeRequestRun | null> {
	const rows = await db
		.select({ id: runs.id, eventId: runs.eventId, headSha: runs.headSha })
		.from(runs)
		.leftJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runs.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
				eq(runs.subjectNumber, subjectNumber),
				eventBearsVerdict,
				liveRun,
			),
		)
		.orderBy(...runRecency)
		.limit(1);
	return rows[0] ?? null;
}

export async function listRunsForChangeRequest(
	db: Db,
	repo: RepoIdentity,
	subjectNumber: number,
) {
	return await db
		.select({
			id: runs.id,
			eventId: runs.eventId,
			status: runs.status,
			verdict: runs.verdict,
			headSha: runs.headSha,
			triggeredBy: runs.triggeredBy,
			createdAt: runs.createdAt,
			eventKind: events.kind,
			actorLogin: events.actorLogin,
		})
		.from(runs)
		.leftJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runs.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
				eq(runs.subjectNumber, subjectNumber),
				eventBearsVerdict,
				liveRun,
			),
		)
		.orderBy(runs.eventId, runs.createdAt, runs.id);
}

/**
 * The verdict the PR currently shows (the active tripwire comment's verdict):
 * the most recent OTHER completed run for this change request. null ⇒ first-time
 * verdict. Drives the resolution copy + whether to dismiss a stale review (§7).
 */
export async function getPreviousVerdict(
	db: Db,
	repo: RepoIdentity,
	subjectNumber: number,
	currentRunId: string,
): Promise<Verdict | null> {
	const rows = await db
		.select({ verdict: runs.verdict })
		.from(runs)
		.leftJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runs.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
				eq(runs.subjectNumber, subjectNumber),
				ne(runs.id, currentRunId),
				isNotNull(runs.verdict),
				eventBearsVerdict,
				liveRun,
			),
		)
		.orderBy(...runRecency)
		.limit(1);
	return (rows[0]?.verdict as Verdict | undefined) ?? null;
}

/**
 * The forge id of the latest tripwire request-changes review on this change
 * request (an executed `block` action's external id). null ⇒ none to dismiss.
 */
export async function getLatestBlockReviewId(
	db: Db,
	repo: RepoIdentity,
	subjectNumber: number,
): Promise<string | null> {
	const rows = await db
		.select({ externalId: runActions.externalId })
		.from(runActions)
		.innerJoin(runs, eq(runActions.runId, runs.id))
		.innerJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runs.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
				eq(runs.subjectNumber, subjectNumber),
				eq(runActions.kind, "block"),
				eq(runActions.status, "executed"),
				isNotNull(runActions.externalId),
			),
		)
		.orderBy(desc(runActions.executedAt))
		.limit(1);
	return rows[0]?.externalId ?? null;
}

export async function getActiveBlockReviewId(
	db: Db,
	repo: RepoIdentity,
	subjectNumber: number,
): Promise<string | null> {
	const reviewId = await getLatestBlockReviewId(db, repo, subjectNumber);
	if (reviewId === null) {
		return null;
	}
	const dismissed = await db
		.select({ id: runActions.id })
		.from(runActions)
		.innerJoin(runs, eq(runActions.runId, runs.id))
		.innerJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runs.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
				eq(runs.subjectNumber, subjectNumber),
				eq(runActions.kind, "dismiss-review"),
				eq(runActions.status, "executed"),
				eq(runActions.externalId, reviewId),
			),
		)
		.limit(1);
	return dismissed.length > 0 ? null : reviewId;
}

export async function completeRun(
	db: Db,
	runId: string,
	verdict: Verdict,
): Promise<void> {
	await db
		.update(runs)
		.set({ status: "completed", verdict, completedAt: new Date() })
		.where(eq(runs.id, runId));
}

type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function getRunStanding(
	db: Queryable,
	runId: string,
): Promise<RunStanding> {
	const runRows = await db
		.select({ headSha: runs.headSha })
		.from(runs)
		.where(eq(runs.id, runId));
	const actions = await db
		.select({ kind: runActions.kind })
		.from(runActions)
		.where(
			and(
				eq(runActions.runId, runId),
				ne(runActions.status, "suppressed"),
				inArray(runActions.kind, ["close", "block", "request-fix"]),
			),
		);
	const outstanding = await db
		.select({ id: moderationItems.id })
		.from(moderationItems)
		.where(
			and(
				eq(moderationItems.runId, runId),
				or(
					eq(moderationItems.status, "pending"),
					and(
						inArray(moderationItems.status, ["approved", "denied"]),
						isNull(moderationItems.appliedAt),
					),
				),
			),
		);
	const count = (kind: string) =>
		actions.filter((action) => action.kind === kind).length;
	return {
		closes: runRows[0]?.headSha ? count("close") : 0,
		blocks: count("block"),
		fixes: count("request-fix"),
		reviewsPending: outstanding.length,
	};
}

export async function settleRun(
	db: Db,
	runId: string,
	appliedItemId: string | null,
): Promise<{ verdict: Verdict; status: "paused" | "completed" }> {
	return db.transaction((tx) =>
		settleRunInTransaction(tx, runId, appliedItemId),
	);
}

/** Resume decisions and their evaluation audit commit together before remote surfaces are attempted. */
export async function persistRunResume(
	db: Db,
	input: {
		runId: string;
		itemId: string;
		decision: "approve" | "deny";
		steps: RecordStepInput[];
		actions: RecordActionInput[];
		moderationNodeIds: string[];
	},
) {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT id FROM runs WHERE id = ${input.runId} FOR UPDATE`,
		);
		const [item] = await tx
			.select()
			.from(moderationItems)
			.where(
				and(
					eq(moderationItems.id, input.itemId),
					eq(moderationItems.runId, input.runId),
				),
			);
		if (
			!item ||
			item.status !== (input.decision === "approve" ? "approved" : "denied")
		)
			throw new Error("Resume decision is missing");
		if (item.appliedAt)
			return {
				...(await settleRunInTransaction(tx, input.runId, null)),
				actionRows: [],
			};
		await recordSteps(tx, input.runId, input.steps);
		const actionRows = await recordActions(tx, input.runId, input.actions);
		const existing = await tx
			.select({ nodeId: moderationItems.nodeId })
			.from(moderationItems)
			.where(eq(moderationItems.runId, input.runId));
		const known = new Set(existing.map((row) => row.nodeId));
		const missing = input.moderationNodeIds.filter(
			(nodeId) => !known.has(nodeId),
		);
		if (missing.length)
			await tx.insert(moderationItems).values(
				missing.map((nodeId) => ({
					id: generateId(),
					runId: input.runId,
					nodeId,
				})),
			);
		const settled = await settleRunInTransaction(tx, input.runId, input.itemId);
		const phase = await getGitCafeEvaluationPhase(tx, input.runId);
		const verdictIds = actionRows
			.filter((row) => GITCAFE_VERDICT_ACTION_KINDS.has(row.kind))
			.map((row) => row.id);
		if (phase && verdictIds.length)
			await tx
				.update(runActions)
				.set({
					payload: sql`${runActions.payload} || jsonb_build_object('gitCafePhase', ${JSON.stringify(phase)}::jsonb)`,
				})
				.where(inArray(runActions.id, verdictIds));
		return { ...settled, actionRows };
	});
}

async function settleRunInTransaction(
	tx: DbLike,
	runId: string,
	appliedItemId: string | null,
): Promise<{ verdict: Verdict; status: "paused" | "completed" }> {
	await tx.execute(sql`SELECT id FROM runs WHERE id = ${runId} FOR UPDATE`);
	if (appliedItemId) {
		await tx
			.update(moderationItems)
			.set({ appliedAt: new Date() })
			.where(eq(moderationItems.id, appliedItemId));
	}
	const standing = await getRunStanding(tx, runId);
	const verdict = standingVerdict(standing);
	const status = standing.reviewsPending > 0 ? "paused" : "completed";
	await tx
		.update(runs)
		.set(
			status === "completed"
				? { status, verdict, completedAt: new Date() }
				: { status, verdict },
		)
		.where(eq(runs.id, runId));
	return { verdict, status };
}

export async function closedOnHead(
	db: Db,
	repo: RepoIdentity,
	subjectNumber: number,
	headSha: string,
): Promise<boolean> {
	const rows = await db
		.select({ id: runActions.id })
		.from(runActions)
		.innerJoin(runs, eq(runActions.runId, runs.id))
		.innerJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runs.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
				eq(runs.subjectNumber, subjectNumber),
				eq(runs.headSha, headSha),
				eq(runActions.kind, "close"),
				eq(runActions.status, "executed"),
			),
		)
		.limit(1);
	return rows.length > 0;
}

export async function pauseRun(db: Db, runId: string): Promise<void> {
	await db
		.update(runs)
		.set({ status: "paused", verdict: "needs_review" })
		.where(eq(runs.id, runId));
}

export async function getRunWithSteps(db: DbLike, runId: string) {
	const runRows = await db.select().from(runs).where(eq(runs.id, runId));
	const run = runRows[0];
	if (!run) {
		return null;
	}
	const steps = await db
		.select()
		.from(runSteps)
		.where(eq(runSteps.runId, runId))
		.orderBy(runSteps.startedAt);
	const actions = await db
		.select()
		.from(runActions)
		.where(eq(runActions.runId, runId));
	return { run, steps, actions };
}

export async function listRuns(
	db: Db,
	{ limit = 50 }: { limit?: number } = {},
) {
	return await db.select().from(runs).orderBy(desc(runs.id)).limit(limit);
}

export async function listRepoRuns(
	db: Db,
	input: { repos: readonly RepoIdentity[]; limit: number },
) {
	if (input.repos.length === 0) {
		return [];
	}
	return await db
		.select({
			id: runs.id,
			repoFullName: runs.repoFullName,
			subjectNumber: runs.subjectNumber,
			status: runs.status,
			verdict: runs.verdict,
			createdAt: runs.createdAt,
			completedAt: runs.completedAt,
			scheduled: sql<boolean>`${events.kind} IS NOT DISTINCT FROM 'schedule.matched'`,
			bearsVerdict: sql<boolean>`${eventBearsVerdict}`,
			backfill: runs.backfill,
		})
		.from(runs)
		.leftJoin(events, eq(events.id, runs.eventId))
		.where(
			or(
				...input.repos.map((repo) =>
					and(
						eq(runs.repoFullName, repo.fullName),
						sql`${events.forge} = ${repo.forge}`,
					),
				),
			),
		)
		.orderBy(desc(runs.id))
		.limit(input.limit);
}

/**
 * The most recent run's id for a repo, or null when none exist — powers the
 * command palette's "latest run" jump (§4). Backed by `runs_repo_created_idx`.
 */
export async function latestRunIdForRepo(
	db: Db,
	repo: RepoIdentity,
): Promise<string | null> {
	const [row] = await db
		.select({ id: runs.id })
		.from(runs)
		.innerJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runs.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
			),
		)
		.orderBy(desc(runs.id))
		.limit(1);
	return row?.id ?? null;
}

export interface ReplayRunRow {
	id: string;
	status: string;
	verdict: string | null;
	workflowSnapshot: unknown;
	deliveryId: string;
	rawKind: string;
	raw: unknown;
	receivedAt: Date;
	normalized: unknown;
	steps: {
		nodeId: string;
		nodeKind: string;
		status: string;
		output: unknown;
	}[];
	/** Latest moderation decision (approved | denied), when one was made. */
	decision: string | null;
	decisionNodeId: string | null;
}

/**
 * §11 verdict replay corpus: every stored run with its raw event, original
 * steps, and the moderation decision that resolved it. Read-only — the
 * append-only store is the replay corpus, never mutated.
 */
export async function listRunsForReplay(
	db: Db,
	limit: number | null,
): Promise<ReplayRunRow[]> {
	const { events } = await import("../schema/events.ts");
	const { moderationItems } = await import("../schema/moderation.ts");
	const base = db
		.select({
			id: runs.id,
			status: runs.status,
			verdict: runs.verdict,
			workflowSnapshot: runs.workflowSnapshot,
			deliveryId: events.deliveryId,
			rawKind: events.rawKind,
			raw: events.raw,
			receivedAt: events.receivedAt,
			normalized: events.normalized,
		})
		.from(runs)
		.innerJoin(events, eq(runs.eventId, events.id))
		.orderBy(runs.id);
	const rows = await (limit ? base.limit(limit) : base);
	const result: ReplayRunRow[] = [];
	for (const row of rows) {
		const steps = await db
			.select({
				nodeId: runSteps.nodeId,
				nodeKind: runSteps.nodeKind,
				status: runSteps.status,
				output: runSteps.output,
			})
			.from(runSteps)
			.where(eq(runSteps.runId, row.id))
			.orderBy(runSteps.startedAt);
		const decisions = await db
			.select({
				status: moderationItems.status,
				nodeId: moderationItems.nodeId,
			})
			.from(moderationItems)
			.where(eq(moderationItems.runId, row.id))
			.orderBy(desc(moderationItems.decidedAt));
		const decided = decisions.find(
			(d) => d.status === "approved" || d.status === "denied",
		);
		result.push({
			...row,
			steps,
			decision: decided?.status ?? null,
			decisionNodeId: decided?.nodeId ?? null,
		});
	}
	return result;
}

export interface OpenBlockedRun {
	runId: string;
	subjectNumber: number;
	headSha: string | null;
	verdict: Verdict;
}

export async function listOpenBlockedRuns(
	db: Db,
	repo: RepoIdentity,
	since: Date,
): Promise<OpenBlockedRun[]> {
	const latest = await db
		.selectDistinctOn([runs.subjectNumber], {
			runId: runs.id,
			subjectNumber: runs.subjectNumber,
			headSha: runs.headSha,
			verdict: runs.verdict,
		})
		.from(runs)
		.leftJoin(events, eq(events.id, runs.eventId))
		.where(
			and(
				eq(runs.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
				isNotNull(runs.subjectNumber),
				gt(runs.createdAt, since),
				eventBearsVerdict,
				liveRun,
			),
		)
		.orderBy(runs.subjectNumber, ...runRecency);
	const blocked = latest.flatMap((row) => {
		const verdict = HELD_VERDICTS.find((held) => held === row.verdict);
		return verdict && row.subjectNumber !== null
			? [
					{
						runId: row.runId,
						subjectNumber: row.subjectNumber,
						headSha: row.headSha,
						verdict,
					},
				]
			: [];
	});
	if (blocked.length === 0) {
		return [];
	}
	const lastLifecycle = await db
		.selectDistinctOn([events.subjectNumber], {
			subjectNumber: events.subjectNumber,
			kind: events.kind,
		})
		.from(events)
		.where(
			and(
				eq(events.repoFullName, repo.fullName),
				sql`${events.forge} = ${repo.forge}`,
				inArray(
					events.subjectNumber,
					blocked.map((row) => row.subjectNumber),
				),
				inArray(events.kind, [
					"change-request.opened",
					"change-request.updated",
					"change-request.closed",
				]),
			),
		)
		.orderBy(events.subjectNumber, desc(events.id));
	const closed = new Set(
		lastLifecycle
			.filter((row) => row.kind === "change-request.closed")
			.map((row) => row.subjectNumber),
	);
	return blocked.filter((row) => !closed.has(row.subjectNumber));
}
