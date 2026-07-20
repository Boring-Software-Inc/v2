import type {
	JsonValue,
	RepoScopedEvent,
	RuleResult,
	Verdict,
	WorkflowDefinition,
} from "@tripwire/contracts";
import { resolveEffectiveRuleConfig, ruleIdOf } from "@tripwire/contracts";
import {
	type AiReviewGenerate,
	deriveDefaultWorkflow,
	evaluateRule,
	executeWorkflow,
	getRule,
	projectRulePublic,
	type RuleContext,
	type StepRecord,
} from "@tripwire/core";
import type { Db } from "@tripwire/db";
import { moderationServices, repoServices, runServices } from "@tripwire/db";
import type { CommentReason } from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
import { buildRuleContext, type WorkerReads } from "../context.ts";
import {
	exemptionFlagRefusedInProd,
	isExemptionDisabled,
} from "../exemption.ts";
import { readsInjectionRefusedInProd } from "../reads-injection.ts";
import { buildCommentReasons } from "./comment-reasons.ts";

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

export function worstVerdict(verdicts: Verdict[]): Verdict {
	return verdicts.reduce<Verdict>(
		(worst, v) => (VERDICT_RANK[v] > VERDICT_RANK[worst] ? v : worst),
		"pass",
	);
}

/**
 * The fail-closed floor predicate (§6): a would-be PASS whose evaluation is
 * mostly guesswork must not silently wave through. One skipped rule still passes
 * (a flaky read can't block a human), but skipped rules at OR above 50% of the
 * active rule nodes routes the run to moderation instead. Pure so both sides of
 * the 50% line are unit-testable without a live run. Only escalates a `pass`.
 */
export function isRunDegraded(
	ruleNodeCount: number,
	skippedCount: number,
	verdict: Verdict,
): boolean {
	return (
		ruleNodeCount > 0 && skippedCount * 2 >= ruleNodeCount && verdict === "pass"
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
	makeGenerate: ((event: RepoScopedEvent) => AiReviewGenerate) | null;
	/**
	 * §5.6b — fire AFTER we know this event will evaluate (matched workflow,
	 * actor not exempt). Emitting the pending check earlier orphans an
	 * `in_progress` gate when exemption returns no run (DECISIONS: exempt
	 * ⇒ no gate, no comment, no check).
	 */
	onBeforeEvaluate?: () => Promise<void>;
	/**
	 * §4 backfill — false ⇒ persist the run/steps/verdict exactly as a live run,
	 * but record its actions as `suppressed` so nothing surfaces on the historical
	 * change request (no comment, no check, no sweeper pickup). Default true.
	 */
	surface?: boolean;
}

export interface RunWorkflowsResult {
	runId: string | null;
	verdict: Verdict | null;
	paused: boolean;
	actionRows: { id: string; kind: string; payload: Record<string, unknown> }[];
	/** The failing rules' reasons for the PR comment (§7/§12). */
	reasons: CommentReason[];
	/** True when the fail-closed floor fired (evaluation degraded). */
	degraded: boolean;
}

export async function runWorkflows(
	deps: RunWorkflowsDeps,
	event: RepoScopedEvent,
	eventId: string,
): Promise<RunWorkflowsResult> {
	const { db, logger } = deps;
	const none: RunWorkflowsResult = {
		runId: null,
		verdict: null,
		paused: false,
		actionRows: [],
		reasons: [],
		degraded: false,
	};

	/**
	 * §6 toggles are REAL now (live-test surprise #1 — the worker never read
	 * rule_configs before). Saved workflows run as authored AND compose with the
	 * derived default over the rules they don't own — a workflow orchestrates
	 * its own rules, it never disables the rest. `disabledRefs` also kill-switch
	 * nodes inside a saved workflow — those rules skip as `disabled`.
	 */
	const repo = await repoServices.getRepoByFullName(db, event.repo.fullName);

	/**
	 * §4 arming gate — an unarmed repo is skipped ENTIRELY: no run, no check, no
	 * comment, no action rows (same shape as the exemption path below). The event
	 * has already ingested + normalized upstream, so the append-only store stays
	 * complete for arm-time backfill; only the RUN is skipped. This is the
	 * product-safety floor: installing on a 400-repo org must not start blocking
	 * PRs on repos the maintainer never armed.
	 */
	if (!repo?.armed) {
		logger.info(
			{ repo: event.repo.fullName },
			"repo not armed — event ingested, run skipped",
		);
		return none;
	}

	const ruleConfigs = repo
		? await repoServices.listRuleConfigs(db, repo.id)
		: [];
	const disabledRefs = new Set(
		ruleConfigs
			.filter((config) => !config.enabled)
			.map((config) => `${config.ruleId}@${config.version}`),
	);
	const custom = await repoServices.listEnabledWorkflows(
		db,
		event.repo.fullName,
	);
	// Saved workflows orchestrate the rules they CONTAIN — they do not turn the
	// rest off. Rules outside every enabled workflow keep running standalone via
	// the derived default over the leftover toggles; owned rule ids are excluded
	// from the derivation so a rule never runs twice with two configs (the
	// workflow node's config wins for owned rules). With no saved workflow the
	// derived default runs alone, even trigger-only (all rules off ⇒ pass run).
	const ownedRuleIds = new Set(
		custom.flatMap((def) =>
			def.nodes.flatMap((node) =>
				node.type === "rule" ? [ruleIdOf(node.ref)] : [],
			),
		),
	);
	// §6 (b) — resolve each pinned config to the version it ACTUALLY runs:
	// auto-advance to current when the config carries forward, hold on the
	// pinned (still-registered) version when it can't. derive keys by rule
	// id, so a held old version replaces — never doubles — the baseline.
	const derived = deriveDefaultWorkflow(
		ruleConfigs.map((config) =>
			resolveEffectiveRuleConfig({
				ruleId: config.ruleId,
				version: config.version,
				enabled: config.enabled,
				config: config.config as JsonValue,
			}),
		),
		ownedRuleIds,
	);
	const derivedHasRules = derived.nodes.some((node) => node.type === "rule");
	const definitions: WorkflowDefinition[] =
		custom.length > 0
			? derivedHasRules
				? [...custom, derived]
				: custom
			: [derived];
	const matching = definitions.filter((def) =>
		def.nodes.some(
			(node) => node.type === "trigger" && node.kinds.includes(event.kind),
		),
	);
	if (matching.length === 0) {
		return none;
	}

	const now = new Date().toISOString();
	const { ctx, degradedReads } = await buildRuleContext(
		event,
		deps.reads,
		now,
		logger,
		deps.makeGenerate?.(event),
	);

	if (exemptionFlagRefusedInProd()) {
		logger.warn(
			"TRIPWIRE_DISABLE_EXEMPTION=true REFUSED under NODE_ENV=production — maintainer exemption stays on",
		);
	}
	if (readsInjectionRefusedInProd()) {
		logger.warn(
			"TRIPWIRE_FAIL_READS REFUSED under NODE_ENV=production — reads run for real",
		);
	}
	const exemptionDisabled = isExemptionDisabled();
	if (
		!exemptionDisabled &&
		(ctx.contributor?.isMaintainer || ctx.contributor?.isOrgMember)
	) {
		logger.info(
			{ actor: event.actor.login },
			"actor exempt (maintainer/org member) — no run",
		);
		return none;
	}

	// Hold the merge button only once evaluation is actually about to run.
	await deps.onBeforeEvaluate?.();

	const evaluateRuleRef = makeEvaluator(ctx, logger);
	const executions = [];
	for (const definition of matching) {
		executions.push({
			definition,
			result: await executeWorkflow({
				definition,
				event,
				evaluateRuleRef,
				isRuleDisabled: (ref) => disabledRefs.has(ref),
				now: () => new Date().toISOString(),
			}),
		});
	}

	let verdict = worstVerdict(executions.map((e) => e.result.verdict));
	let paused = executions.some((e) => e.result.pausedAtNodeId !== null);
	const steps: StepRecord[] = executions.flatMap((execution) =>
		execution.result.steps.map((step) => ({
			...step,
			nodeId: `${execution.definition.id}:${step.nodeId}`,
		})),
	);

	/**
	 * Fail-closed floor (amends the step-6 composition): ONE skipped rule
	 * still conducts as pass — a flaky read must not block a human — but a
	 * run whose evaluation is mostly guesswork never passes. All-skipped or
	 * skipped ≥ 50% of rule nodes ⇒ needs_review, routed to moderation.
	 * Disabled rules (§6 kill switch) are DELIBERATE, not degraded — excluded
	 * from both sides of the ratio.
	 */
	const ruleSteps0 = steps.filter(
		(step) => step.nodeKind === "rule" && step.status !== "disabled",
	);
	const skippedCount = ruleSteps0.filter(
		(step) => step.status === "skipped",
	).length;
	const degraded = isRunDegraded(ruleSteps0.length, skippedCount, verdict);
	if (degraded) {
		verdict = "needs_review";
		paused = true;
		const startedAt = new Date().toISOString();
		steps.push({
			nodeId: "run:degradation",
			nodeKind: "gate",
			status: "skipped",
			input: { rule: "fail-closed floor" },
			output: {
				degradedReads,
				skippedRules: skippedCount,
				ruleNodes: ruleSteps0.length,
			},
			startedAt,
			finishedAt: startedAt,
			durationMs: 0,
		});
		logger.warn(
			{ degradedReads, skippedCount, ruleNodes: ruleSteps0.length },
			"evaluation degraded — fail-closed floor routes run to moderation",
		);
	}

	const runId = await runServices.createRun(db, {
		eventId,
		repoFullName: event.repo.fullName,
		subjectNumber: "changeRequest" in event ? event.changeRequest.number : null,
		headSha: "changeRequest" in event ? event.changeRequest.headSha : null,
		snapshot: matching,
		status: paused ? "paused" : "completed",
		verdict,
	});
	await runServices.recordSteps(db, runId, withPublicProjection(steps));

	for (const execution of executions) {
		if (execution.result.pausedAtNodeId) {
			await moderationServices.createModerationItem(db, {
				runId,
				nodeId: `${execution.definition.id}:${execution.result.pausedAtNodeId}`,
			});
		}
	}
	if (degraded) {
		await moderationServices.createModerationItem(db, {
			runId,
			nodeId: "run:degraded",
		});
	}

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
		deps.surface === false ? "suppressed" : "recorded",
	);

	const reasons = buildCommentReasons(steps);
	logger.info({ runId, verdict, paused, steps: steps.length }, "run persisted");
	return { runId, verdict, paused, actionRows, reasons, degraded };
}

/**
 * §10 — enrich each rule step with its public partition + one-liner, projected
 * by the rule itself (core). Non-rule steps and skipped rules (null evidence)
 * pass through with no public evidence. This is the ONLY place the projection
 * runs — a single home for the rule knowledge, no drift surface.
 */
export type PersistStep = StepRecord & {
	publicEvidence?: unknown;
	summary?: string | null;
};

export function withPublicProjection(steps: StepRecord[]): PersistStep[] {
	return steps.map((step) => {
		if (step.nodeKind !== "rule" || !step.ruleRef) {
			return step;
		}
		const envelope = step.output;
		const inner =
			envelope && typeof envelope === "object" && "evidence" in envelope
				? (envelope as { evidence: unknown }).evidence
				: null;
		const { publicEvidence, summary } = projectRulePublic(step.ruleRef, inner);
		return { ...step, publicEvidence, summary };
	});
}

export function makeEvaluator(ctx: RuleContext, logger: Logger) {
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
