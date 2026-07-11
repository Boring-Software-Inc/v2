import type {
	NormalizedEvent,
	RuleResult,
	Verdict,
	WorkflowDefinition,
} from "@tripwire/contracts";
import {
	type AiReviewGenerate,
	evaluateRule,
	executeWorkflow,
	getRule,
	type RuleContext,
	type StepRecord,
} from "@tripwire/core";
import type { Db } from "@tripwire/db";
import { repoServices, runServices } from "@tripwire/db";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
import { buildRuleContext, type WorkerReads } from "../context.ts";
import { DEFAULT_WORKFLOW } from "../default-workflow.ts";

/**
 * §5.7–5.12: match enabled workflows by trigger → build RuleContext (reads
 * pre-fetched) → executor walks each DAG → the results JOIN into ONE run
 * (§5.11: one button on the PR) with the definitions SNAPSHOT on it → actions
 * recorded as rows first. Verdict severity: block > needs_review > pass.
 */

const VERDICT_RANK: Record<Verdict, number> = {
	pass: 0,
	needs_review: 1,
	block: 2,
};

function worstVerdict(verdicts: Verdict[]): Verdict {
	return verdicts.reduce<Verdict>(
		(worst, v) => (VERDICT_RANK[v] > VERDICT_RANK[worst] ? v : worst),
		"pass",
	);
}

function skippedResult(ref: string, reason: string, now: string): RuleResult {
	const [id, version] = ref.split("@");
	return {
		ruleId: id ?? ref,
		version: Number(version ?? 0) || 1,
		status: "skipped",
		passed: false,
		evidence: null,
		reason,
		evaluatedAt: now,
	};
}

export interface RunWorkflowsDeps {
	db: Db;
	logger: Logger;
	reads: WorkerReads | null;
	/** §8 — injected AI effect factory; null without ANTHROPIC_API_KEY. */
	makeGenerate: ((event: NormalizedEvent) => AiReviewGenerate) | null;
}

export interface RunWorkflowsResult {
	runId: string | null;
	verdict: Verdict | null;
	paused: boolean;
	actionRows: { id: string; kind: string; payload: Record<string, unknown> }[];
	stats: { evaluated: number; failed: number };
}

export async function runWorkflows(
	deps: RunWorkflowsDeps,
	event: NormalizedEvent,
	eventId: string,
): Promise<RunWorkflowsResult> {
	const { db, logger } = deps;
	const none: RunWorkflowsResult = {
		runId: null,
		verdict: null,
		paused: false,
		actionRows: [],
		stats: { evaluated: 0, failed: 0 },
	};

	const custom = await repoServices.listEnabledWorkflows(
		db,
		event.repo.fullName,
	);
	const definitions: WorkflowDefinition[] =
		custom.length > 0 ? custom : [DEFAULT_WORKFLOW];
	const matching = definitions.filter((def) =>
		def.nodes.some(
			(node) => node.type === "trigger" && node.kinds.includes(event.kind),
		),
	);
	if (matching.length === 0) {
		return none;
	}

	const now = new Date().toISOString();
	const ctx = await buildRuleContext(
		event,
		deps.reads,
		now,
		logger,
		deps.makeGenerate?.(event),
	);

	if (ctx.contributor?.isMaintainer || ctx.contributor?.isOrgMember) {
		logger.info(
			{ actor: event.actor.login },
			"actor exempt (maintainer/org member) — no run",
		);
		return none;
	}

	const evaluateRuleRef = makeEvaluator(ctx, logger);
	const executions = [];
	for (const definition of matching) {
		executions.push({
			definition,
			result: await executeWorkflow({
				definition,
				event,
				evaluateRuleRef,
				now: () => new Date().toISOString(),
			}),
		});
	}

	const verdict = worstVerdict(executions.map((e) => e.result.verdict));
	const paused = executions.some((e) => e.result.pausedAtNodeId !== null);
	const steps: StepRecord[] = executions.flatMap((execution) =>
		execution.result.steps.map((step) => ({
			...step,
			nodeId: `${execution.definition.id}:${step.nodeId}`,
		})),
	);

	const runId = await runServices.createRun(db, {
		eventId,
		repoFullName: event.repo.fullName,
		subjectNumber: "changeRequest" in event ? event.changeRequest.number : null,
		headSha: "changeRequest" in event ? event.changeRequest.headSha : null,
		snapshot: matching,
		status: paused ? "paused" : "completed",
		verdict,
	});
	await runServices.recordSteps(db, runId, steps);

	const actionRows = await runServices.recordActions(
		db,
		runId,
		executions.flatMap((execution) =>
			execution.result.actions.map((action) => ({
				kind: action.action,
				payload: {
					...action.params,
					nodeId: `${execution.definition.id}:${action.nodeId}`,
				},
				idempotencyKey: `${action.action}:${execution.definition.id}:${action.nodeId}`,
			})),
		),
	);

	const ruleSteps = steps.filter((step) => step.nodeKind === "rule");
	const stats = {
		evaluated: ruleSteps.length,
		failed: ruleSteps.filter((step) => step.status === "fail").length,
	};
	logger.info({ runId, verdict, paused, steps: steps.length }, "run persisted");
	return { runId, verdict, paused, actionRows, stats };
}

function makeEvaluator(ctx: RuleContext, logger: Logger) {
	return async (ref: string, config: unknown): Promise<RuleResult> => {
		const rule = getRule(ref);
		if (!rule) {
			return skippedResult(ref, `unknown rule ${ref}`, ctx.now);
		}
		try {
			return await evaluateRule(rule, ctx, config);
		} catch (error) {
			logger.error(
				{ ref, error: getErrorMessage(error) },
				"rule threw — treated as skipped (bug)",
			);
			return skippedResult(
				ref,
				`rule threw: ${getErrorMessage(error)}`,
				ctx.now,
			);
		}
	};
}
