import type {
	NormalizedEvent,
	RepoScopedEvent,
	WorkflowDefinition,
} from "@tripwire/contracts";
import { workflowDefinitionSchema } from "@tripwire/contracts";
import { executeWorkflow, type NodeOutcome } from "@tripwire/core";
import { eventServices, moderationServices, runServices } from "@tripwire/db";
import { z } from "zod";
import { buildRuleContext } from "../context.ts";
import { emitPrSurface } from "./pr-surface.ts";
import type { ProcessEventDeps } from "./process-event.ts";
import { makeEvaluator } from "./run-workflows.ts";

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

	await runServices.recordSteps(
		db,
		item.runId,
		result.steps.map((step) => ({
			...step,
			nodeId: `${definition.id}:${step.nodeId}:resume`,
		})),
	);
	await runServices.completeRun(db, item.runId, result.verdict);

	const actionRows = await runServices.recordActions(
		db,
		item.runId,
		result.actions.map((action) => ({
			kind: action.action,
			payload: {
				...action.params,
				nodeId: `${definition.id}:${action.nodeId}`,
			},
			idempotencyKey: `${action.action}:${definition.id}:${action.nodeId}:resume`,
		})),
	);

	const allRuleSteps = [...runData.steps].filter(
		(step) => step.nodeKind === "rule",
	);
	await emitPrSurface(
		{
			db,
			adapter: deps.adapter,
			logger,
			appUrl: deps.appUrl,
		},
		{
			runId: item.runId,
			verdict: result.verdict,
			event: normalized,
			stats: {
				evaluated: allRuleSteps.length,
				failed: allRuleSteps.filter((step) => step.status === "fail").length,
			},
			pendingActionRows: actionRows,
		},
	);
	logger.info(
		{ runId: item.runId, decision: job.decision, verdict: result.verdict },
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
	const ruleSteps = runData.steps.filter((step) => step.nodeKind === "rule");
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
			stats: {
				evaluated: ruleSteps.length,
				failed: ruleSteps.filter((step) => step.status === "fail").length,
			},
			pendingActionRows: actionRows,
		},
	);
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
