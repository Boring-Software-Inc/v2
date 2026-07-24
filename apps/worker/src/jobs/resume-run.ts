import type {
	NormalizedEvent,
	RepoScopedEvent,
	Verdict,
	WorkflowDefinition,
} from "@tripwire/contracts";
import { workflowDefinitionSchema } from "@tripwire/contracts";
import { executeWorkflow, type NodeOutcome } from "@tripwire/core";
import { eventServices, moderationServices, runServices } from "@tripwire/db";
import { z } from "zod";
import { buildRuleContext } from "../context.ts";
import { buildCommentReasons } from "./comment-reasons.ts";
import { emitPrSurface } from "./pr-surface.ts";
import type { ProcessEventDeps } from "./process-event.ts";
import { makeEvaluator, withPublicProjection } from "./run-workflows.ts";

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
	const normalized: RepoScopedEvent = parsed;

	if (item.nodeId === "run:degraded") {
		await resumeDegradedRun(
			deps,
			item.runId,
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

	const outcomes = deriveOutcomes(definition, runData.steps, wfId);
	const now = new Date().toISOString();
	const { ctx } = await buildRuleContext(
		normalized,
		deps.reads,
		now,
		logger,
		deps.makeGenerate?.(normalized),
	);

	const result = await executeWorkflow({
		definition,
		event: normalized,
		evaluateRuleRef: makeEvaluator(ctx, logger),
		now: () => new Date().toISOString(),
		resume: { outcomes, nodeId: pausedNode, decision: job.decision },
	});

	// The verdict is the maintainer's decision, not the graph's traversal —
	// deny always blocks, and floors in a block action when the graph made none.
	const { verdict, floorBlock: denyFloored } = resolveResumeOutcome(
		job.decision,
		result,
	);

	const steps = result.steps.map((step) => ({
		...step,
		nodeId: `${definition.id}:${step.nodeId}:resume`,
	}));
	if (denyFloored) {
		const at = new Date().toISOString();
		steps.push({
			nodeId: "run:deny-floor",
			nodeKind: "action",
			status: "pass",
			input: { decision: "deny", pausedNodeId: item.nodeId },
			output: { rule: "deny → block (graph produced no block action)" },
			startedAt: at,
			finishedAt: at,
			durationMs: 0,
		});
		logger.warn(
			{ runId: item.runId, pausedNodeId: item.nodeId },
			"deny produced no block action — verdict floored to block",
		);
	}
	await runServices.recordSteps(db, item.runId, withPublicProjection(steps));
	await runServices.completeRun(db, item.runId, verdict);

	const actionRows = await runServices.recordActions(db, item.runId, [
		...result.actions.map((action) => ({
			kind: action.action,
			payload: {
				...action.params,
				nodeId: `${definition.id}:${action.nodeId}`,
			},
			idempotencyKey: `${action.action}:${definition.id}:${action.nodeId}:resume`,
		})),
		...(denyFloored
			? [
					{
						kind: "block",
						payload: {
							reason:
								"denied by maintainer — graph drew no block on the deny path",
						},
						idempotencyKey: `block:${definition.id}:${pausedNode}:deny-floor`,
					},
				]
			: []),
	]);

	await emitPrSurface(
		{
			db,
			adapter: deps.adapter,
			logger,
			appUrl: deps.appUrl,
		},
		{
			runId: item.runId,
			verdict,
			event: normalized,
			reasons: buildCommentReasons(runData.steps),
			pendingActionRows: actionRows,
		},
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
	decision: "approve" | "deny",
	normalized: NormalizedEvent,
	runData: NonNullable<Awaited<ReturnType<typeof runServices.getRunWithSteps>>>,
): Promise<void> {
	const verdict = decision === "approve" ? "pass" : "block";
	await runServices.completeRun(deps.db, runId, verdict);
	const actionRows =
		decision === "deny"
			? await runServices.recordActions(deps.db, runId, [
					{
						kind: "block",
						payload: { reason: "degraded evaluation denied by maintainer" },
						idempotencyKey: "block:degraded:deny",
					},
				])
			: [];
	await emitPrSurface(
		{
			db: deps.db,
			adapter: deps.adapter,
			logger: deps.logger,
			appUrl: deps.appUrl,
		},
		{
			runId,
			verdict,
			event: normalized,
			reasons: buildCommentReasons(runData.steps),
			pendingActionRows: actionRows,
		},
	);
	await deps.pool.query("SELECT pg_notify('runs', $1)", [runData.run.eventId]);
	deps.logger.info({ runId, decision, verdict }, "degraded run resumed");
}

function splitNodeId(nodeId: string): [string, string | null] {
	const index = nodeId.indexOf(":");
	if (index === -1) {
		return [nodeId, null];
	}
	return [nodeId.slice(0, index), nodeId.slice(index + 1)];
}

function deriveOutcomes(
	definition: WorkflowDefinition,
	steps: { nodeId: string; status: string }[],
	wfId: string,
): Record<string, NodeOutcome> {
	const outcomes: Record<string, NodeOutcome> = {};
	for (const step of steps) {
		if (!step.nodeId.startsWith(`${wfId}:`)) {
			continue;
		}
		const local = step.nodeId.slice(wfId.length + 1);
		if (definition.nodes.some((node) => node.id === local)) {
			outcomes[local] = step.status === "fail" ? "fail" : "pass";
		}
	}
	return outcomes;
}
