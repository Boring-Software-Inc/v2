import {
	ruleResultSchema,
	type Verdict,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, desc, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../client.ts";
import { runActions, runSteps, runs } from "../schema/runs.ts";

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
}

export async function createRun(db: Db, input: CreateRunInput) {
	const snapshot = snapshotSchema.parse(input.snapshot);
	const id = input.id ?? generateId();
	await db.insert(runs).values({
		id,
		eventId: input.eventId,
		repoFullName: input.repoFullName,
		subjectNumber: input.subjectNumber,
		headSha: input.headSha,
		status: input.status,
		verdict: input.verdict,
		workflowSnapshot: snapshot,
		triggeredBy: input.triggeredBy ?? null,
		completedAt: input.status === "completed" ? new Date() : null,
	});
	return id;
}

export interface FinalizeRunInput {
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
	db: Db,
	runId: string,
	input: FinalizeRunInput,
): Promise<void> {
	const snapshot = snapshotSchema.parse(input.snapshot);
	await db
		.update(runs)
		.set({
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
	input: { snapshot: WorkflowDefinition[]; headSha: string | null },
): Promise<void> {
	const snapshot = snapshotSchema.parse(input.snapshot);
	await db
		.update(runs)
		.set({
			status: "running",
			workflowSnapshot: snapshot,
			headSha: input.headSha,
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

export async function getRunById(db: Db, runId: string) {
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
): Promise<{ id: string; eventId: string; repoFullName: string }[]> {
	const rows = await db
		.select({
			id: runs.id,
			eventId: runs.eventId,
			repoFullName: runs.repoFullName,
		})
		.from(runs)
		.where(and(eq(runs.status, "queued"), lt(runs.createdAt, createdBefore)));
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
	db: Db,
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
	db: Db,
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
	const rows = actions.map((action) => ({
		id: generateId(),
		runId,
		kind: action.kind,
		payload: action.payload,
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
}

/**
 * Surface actions still `recorded` past a cutoff — recorded-first rows whose
 * execution was blocked by a forge outage (§5.12). The sweeper re-attempts
 * them (idempotency keys make retries safe) once credentials recover.
 */
export async function listStuckActions(
	db: Db,
	recordedBefore: Date,
): Promise<StuckAction[]> {
	const rows = await db
		.select({
			id: runActions.id,
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
		})
		.from(runActions)
		.innerJoin(runs, eq(runActions.runId, runs.id))
		.where(
			and(
				eq(runActions.status, "recorded"),
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
 * the comment. Latest by creation time (UUIDv7 id breaks ties).
 */
export async function getLatestRunIdForChangeRequest(
	db: Db,
	repoFullName: string,
	subjectNumber: number,
): Promise<string | null> {
	const rows = await db
		.select({ id: runs.id })
		.from(runs)
		.where(
			and(
				eq(runs.repoFullName, repoFullName),
				eq(runs.subjectNumber, subjectNumber),
			),
		)
		.orderBy(desc(runs.createdAt), desc(runs.id))
		.limit(1);
	return rows[0]?.id ?? null;
}

/**
 * The verdict the PR currently shows (the active tripwire comment's verdict):
 * the most recent OTHER completed run for this change request. null ⇒ first-time
 * verdict. Drives the resolution copy + whether to dismiss a stale review (§7).
 */
export async function getPreviousVerdict(
	db: Db,
	repoFullName: string,
	subjectNumber: number,
	currentRunId: string,
): Promise<Verdict | null> {
	const rows = await db
		.select({ verdict: runs.verdict })
		.from(runs)
		.where(
			and(
				eq(runs.repoFullName, repoFullName),
				eq(runs.subjectNumber, subjectNumber),
				ne(runs.id, currentRunId),
				isNotNull(runs.verdict),
			),
		)
		.orderBy(desc(runs.createdAt), desc(runs.id))
		.limit(1);
	return (rows[0]?.verdict as Verdict | undefined) ?? null;
}

/**
 * The forge id of the latest tripwire request-changes review on this change
 * request (an executed `block` action's external id). null ⇒ none to dismiss.
 */
export async function getLatestBlockReviewId(
	db: Db,
	repoFullName: string,
	subjectNumber: number,
): Promise<string | null> {
	const rows = await db
		.select({ externalId: runActions.externalId })
		.from(runActions)
		.innerJoin(runs, eq(runActions.runId, runs.id))
		.where(
			and(
				eq(runs.repoFullName, repoFullName),
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

export async function pauseRun(db: Db, runId: string): Promise<void> {
	await db
		.update(runs)
		.set({ status: "paused", verdict: "needs_review" })
		.where(eq(runs.id, runId));
}

export async function getRunWithSteps(db: Db, runId: string) {
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

/**
 * The most recent run's id for a repo, or null when none exist — powers the
 * command palette's "latest run" jump (§4). Backed by `runs_repo_created_idx`.
 */
export async function latestRunIdForRepo(
	db: Db,
	repoFullName: string,
): Promise<string | null> {
	const [row] = await db
		.select({ id: runs.id })
		.from(runs)
		.where(eq(runs.repoFullName, repoFullName))
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
