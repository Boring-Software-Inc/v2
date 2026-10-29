import type {
	Forge,
	NodeOutcome,
	NormalizedEvent,
	RepoScopedEvent,
	Verdict,
	WorkflowDefinition,
} from "@tripwire/contracts";
import {
	isAiReviewNotRunStep,
	stepLocalId,
	verdictSchema,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { executeWorkflow, type StepRecord } from "@tripwire/core";
import {
	eventServices,
	moderationServices,
	repoServices,
	runServices,
} from "@tripwire/db";
import { createForgeSignalCtx } from "@tripwire/sdk";
import { z } from "zod";
import { buildRuleContext } from "../context.ts";
import { buildCommentReasons } from "./comment-reasons.ts";
import { customRuleSource } from "./custom-rules.ts";
import { type EmitSurfaceInput, emitPrSurface } from "./pr-surface.ts";
import type { ProcessEventDeps } from "./process-event.ts";
import {
	actionPayload,
	makeEvaluator,
	postsSomething,
	withPublicProjection,
} from "./run-workflows.ts";

/**
 * The resumed run's outcome is the MAINTAINER's decision, not a function of
 * which nodes the graph happened to walk (T4 floor, hardened after a prod miss:
 * a deny edge drawn to a non-block action — discord — resumed to `pass`, a green
 * check on an explicitly denied change). Deny means blocked, full stop: a deny
 * edge to a non-block action, or to nowhere, still blocks. Approve resumes to
 * the graph's own verdict — that IS the correct reading of approve. `floorBlock`
 * is true when deny is chosen but the graph conducted no block of its own, so the
 * caller records a synthetic block action + audit step.
 */
export function resolveResumeOutcome(
	decision: "approve" | "deny",
	graph: { verdict: Verdict; actions: readonly { action: string }[] },
): { verdict: Verdict; floorBlock: boolean } {
	if (decision === "deny") {
		return {
			verdict: "block",
			floorBlock: !graph.actions.some((action) => action.action === "block"),
		};
	}
	return { verdict: graph.verdict, floorBlock: false };
}

export function resumedSteps(
	definitionId: string,
	steps: readonly StepRecord[],
	floorPausedNodeId: string | null,
	at: string,
): StepRecord[] {
	const resumed = steps.map((step) => ({
		...step,
		nodeId: `${definitionId}:${step.nodeId}:resume`,
	}));
	if (floorPausedNodeId === null) {
		return resumed;
	}
	return [
		...resumed,
		{
			nodeId: "run:deny-floor",
			nodeKind: "action",
			status: "pass",
			input: { decision: "deny", pausedNodeId: floorPausedNodeId },
			output: { rule: "deny → block (graph produced no block action)" },
			startedAt: at,
			finishedAt: at,
			durationMs: 0,
		},
	];
}

/**
 * §6 — a moderation decision resumes the paused run down the corresponding
 * edge. The workflow SNAPSHOT drives the resume (edits after the pause change
 * nothing); node outcomes are derived from the persisted run_steps.
 */
export async function resumeRun(
	deps: ProcessEventDeps,
	job: { itemId: string; decision: "approve" | "deny" },
): Promise<void> {
	const { db, logger } = deps;
	const item = await moderationServices.getModerationItem(db, job.itemId);
	if (!item) {
		logger.error({ itemId: job.itemId }, "moderation item not found");
		return;
	}
	const runData = await runServices.getRunWithSteps(db, item.runId);
	if (!runData || runData.run.status !== "paused") {
		logger.warn({ runId: item.runId }, "run not paused — resume is a no-op");
		return;
	}
	const event = await eventServices.getEventById(db, runData.run.eventId);
	if (!event?.normalized) {
		logger.error({ runId: item.runId }, "run event missing normalized form");
		return;
	}
	const parsed = event.normalized as NormalizedEvent;
	if (!("repo" in parsed)) {
		logger.error({ runId: item.runId }, "run event is not repo-scoped");
		return;
	}
	if (
		parsed.forge !== event.forge ||
		parsed.repo.fullName !== runData.run.repoFullName
	) {
		logger.error({ runId: item.runId }, "run event repository scope mismatch");
		return;
	}
	const normalized: RepoScopedEvent = parsed;

	if (item.nodeId === "run:degraded") {
		await resumeDegradedRun(
			deps,
			item.runId,
			item.id,
			job.decision,
			normalized,
			runData,
		);
		return;
	}

	const [wfId, pausedNode] = splitNodeId(item.nodeId);
	const snapshot = z
		.array(workflowDefinitionSchema)
		.parse(runData.run.workflowSnapshot);
	const definition = snapshot.find((def) => def.id === wfId);
	if (!(definition && pausedNode)) {
		logger.error({ nodeId: item.nodeId }, "paused workflow not in snapshot");
		return;
	}

	const { outcomes, decisions } = deriveOutcomes(
		definition,
		runData.steps,
		wfId,
	);
	const now = new Date().toISOString();
	const { ctx } = await buildRuleContext(
		normalized,
		deps.resolveForge(normalized.forge)?.reads ?? null,
		now,
		logger,
		deps.makeGenerate?.(normalized),
	);
	const repo = await repoServices.getRepoByFullName(
		db,
		normalized.repo.fullName,
		normalized.forge,
	);
	const http = deps.resolveForge(normalized.forge)?.signalHttp;
	const custom = customRuleSource(
		repo ? await repoServices.listCustomRules(db, repo.id) : [],
		http ? createForgeSignalCtx({ forge: http, event: normalized, now }) : null,
	);

	const result = await executeWorkflow({
		definition,
		event: normalized,
		evaluateRuleRef: makeEvaluator(ctx, logger, custom),
		now: () => new Date().toISOString(),
		resume: {
			outcomes,
			nodeId: pausedNode,
			decision: job.decision,
			decisions,
		},
	});

	const { floorBlock: denyFloored } = resolveResumeOutcome(
		job.decision,
		result,
	);

	const steps = resumedSteps(
		definition.id,
		result.steps,
		denyFloored ? item.nodeId : null,
		new Date().toISOString(),
	);
	if (denyFloored) {
		logger.warn(
			{ runId: item.runId, pausedNodeId: item.nodeId },
			"deny produced no block action — verdict floored to block",
		);
	}
	await runServices.recordSteps(db, item.runId, withPublicProjection(steps));

	const actionRows = await runServices.recordActions(db, item.runId, [
		...result.actions.filter(postsSomething).map((action) => ({
			kind: action.action,
			payload: actionPayload(action, definition.id, item.runId),
			idempotencyKey: `${action.action}:${definition.id}:${action.nodeId}:resume`,
		})),
		...(denyFloored
			? [
					{
						kind: "block",
						payload: {
							reason: "A maintainer reviewed this and blocked it.",
						},
						idempotencyKey: `block:${definition.id}:${pausedNode}:deny-floor`,
					},
				]
			: []),
	]);
	const known = new Set(
		(await moderationServices.listModerationItemsForRun(db, item.runId)).map(
			(existing) => existing.nodeId,
		),
	);
	for (const nodeId of result.pausedAtNodeIds) {
		const scoped = `${definition.id}:${nodeId}`;
		if (!known.has(scoped)) {
			await moderationServices.createModerationItem(db, {
				runId: item.runId,
				nodeId: scoped,
			});
		}
	}
	const { verdict } = await runServices.settleRun(db, item.runId, item.id);

	const customRecords = await loadCustomRecords(
		db,
		normalized.repo.fullName,
		normalized.forge,
	);
	const surface: EmitSurfaceInput = {
		runId: item.runId,
		verdict,
		event: normalized,
		reasons: buildCommentReasons(runData.steps, customRecords),
		aiReviewNotRun: runData.steps.some(isAiReviewNotRunStep),
		pendingActionRows: actionRows,
		pendingCheckPosted: true,
		resumedFrom: resumedFrom(runData.run.verdict),
	};
	if (verdict === runData.run.verdict) {
		surface.surfaceKey = `resume:${item.id}`;
	}
	await emitPrSurface(
		{
			db,
			adapter: deps.resolveForge(normalized.forge)?.adapter ?? null,
			logger,
			appUrl: deps.appUrl,
		},
		surface,
	);
	// §9 live activity feed: the resumed run's verdict changed — announce it.
	await deps.pool.query("SELECT pg_notify('runs', $1)", [runData.run.eventId]);
	logger.info(
		{ runId: item.runId, decision: job.decision, verdict },
		"moderated run resumed",
	);
}

/**
 * Fail-closed floor resume: no workflow node paused this run — degradation
 * did. approve ⇒ pass; deny ⇒ block (with the block recorded and executed).
 */
async function resumeDegradedRun(
	deps: ProcessEventDeps,
	runId: string,
	itemId: string,
	decision: "approve" | "deny",
	normalized: NormalizedEvent,
	runData: NonNullable<Awaited<ReturnType<typeof runServices.getRunWithSteps>>>,
): Promise<void> {
	const actionRows =
		decision === "deny"
			? await runServices.recordActions(deps.db, runId, [
					{
						kind: "block",
						payload: {
							reason:
								"Tripwire could not finish checking this. A maintainer reviewed it and blocked it.",
						},
						idempotencyKey: "block:degraded:deny",
					},
				])
			: [];
	const { verdict } = await runServices.settleRun(deps.db, runId, itemId);
	const customRecords = await loadCustomRecords(
		deps.db,
		runData.run.repoFullName,
		normalized.forge,
	);
	const surface: EmitSurfaceInput = {
		runId,
		verdict,
		event: normalized,
		reasons: buildCommentReasons(runData.steps, customRecords),
		aiReviewNotRun: runData.steps.some(isAiReviewNotRunStep),
		pendingActionRows: actionRows,
		pendingCheckPosted: true,
		resumedFrom: resumedFrom(runData.run.verdict),
	};
	if (verdict === runData.run.verdict) {
		surface.surfaceKey = "resume:degraded";
	}
	await emitPrSurface(
		{
			db: deps.db,
			adapter: deps.resolveForge(normalized.forge)?.adapter ?? null,
			logger: deps.logger,
			appUrl: deps.appUrl,
		},
		surface,
	);
	await deps.pool.query("SELECT pg_notify('runs', $1)", [runData.run.eventId]);
	deps.logger.info({ runId, decision, verdict }, "degraded run resumed");
}

/** The repo's custom rule records, keyed by ref — so a resumed run's comment
 * resolves custom rule names + evidence the same way the fresh run did. Signal
 * ctx is null: only the stored name + definition are needed here, not evaluation. */
async function loadCustomRecords(
	db: ProcessEventDeps["db"],
	repoFullName: string,
	forge: Forge,
) {
	const repo = await repoServices.getRepoByFullName(db, repoFullName, forge);
	const rows = repo ? await repoServices.listCustomRules(db, repo.id) : [];
	return customRuleSource(rows, null).records;
}

function splitNodeId(nodeId: string): [string, string | null] {
	const index = nodeId.indexOf(":");
	if (index === -1) {
		return [nodeId, null];
	}
	return [nodeId.slice(0, index), nodeId.slice(index + 1)];
}

function resumedFrom(stored: string | null): Verdict {
	const parsed = verdictSchema.safeParse(stored);
	return parsed.success ? parsed.data : "needs_review";
}

const decisionInputSchema = z
	.object({ decision: z.enum(["approve", "deny"]) })
	.nullable()
	.catch(null);

export function deriveOutcomes(
	definition: WorkflowDefinition,
	steps: { nodeId: string; status: string; input?: unknown }[],
	wfId: string,
) {
	const outcomes: Record<string, NodeOutcome> = {};
	const decisions: Record<string, "approve" | "deny"> = {};
	for (const step of steps) {
		const local = stepLocalId(step.nodeId, wfId);
		if (local === null || !definition.nodes.some((node) => node.id === local)) {
			continue;
		}
		outcomes[local] =
			step.status === "fail" || step.status === "skipped"
				? step.status
				: "pass";
		const decision = decisionInputSchema.parse(step.input ?? null)?.decision;
		if (decision) {
			decisions[local] = decision;
		}
	}
	return { outcomes, decisions };
}
