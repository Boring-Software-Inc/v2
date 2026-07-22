import type {
	JsonValue,
	RepoScopedEvent,
	RuleResult,
	Verdict,
	WorkflowDefinition,
} from "@tripwire/contracts";
import {
	type CustomRuleRecord,
	customRuleRef,
	customRuleSummary,
	resolveEffectiveRuleConfig,
	ruleIdOf,
} from "@tripwire/contracts";
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
import type { CommentReason, GithubHttp } from "@tripwire/forge-github";
import { createForgeSignalCtx } from "@tripwire/sdk";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
import { buildRuleContext, type WorkerReads } from "../context.ts";
import {
	exemptionFlagRefusedInProd,
	isExemptionDisabled,
} from "../exemption.ts";
import { readsInjectionRefusedInProd } from "../reads-injection.ts";
import { buildCommentReasons } from "./comment-reasons.ts";
import {
	type CustomRuleSource,
	customRuleSource,
	evaluateCustomRule,
} from "./custom-rules.ts";

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
	/** Pre-authed GitHub client for custom-rule signal producers; null when
	 * forge reads are disabled (custom rules skip, like built-ins do). */
	signalHttp?: GithubHttp | null;
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
	/** Manual re-run: the triggering admin's user id, stamped on the run. */
	triggeredBy?: string;
	/**
	 * Pre-materialized run id (re-run enqueue). When set, finalize that row
	 * instead of inserting a new one — the activity card already points here.
	 */
	claimRunId?: string;
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
	 * §6 rule authority: a rule PLACED in a saved workflow is owned by that
	 * workflow — it runs because it is wired, and the standalone /rules toggle
	 * does not gate it. The toggle governs only standalone use: it shapes the
	 * derived default over the rules NOT in any enabled workflow (owned ids are
	 * excluded below, and `deriveDefaultWorkflow` drops toggled-off rules from
	 * the default's nodes). To turn a workflowed rule off, remove it from the
	 * workflow first.
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
		if (deps.claimRunId) {
			await runServices.failRun(db, deps.claimRunId);
		}
		return none;
	}

	const ruleConfigs = repo
		? await repoServices.listRuleConfigs(db, repo.id)
		: [];
	const customRows = repo
		? await repoServices.listCustomRules(db, repo.id)
		: [];

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
		[
			...ruleConfigs.map((config) =>
				resolveEffectiveRuleConfig({
					ruleId: config.ruleId,
					version: config.version,
					enabled: config.enabled,
					config: config.config as JsonValue,
				}),
			),
			// Custom rules join the toggle set like any non-baseline rule: they
			// run when enabled, and workflow ownership excludes them like any id.
			...customRows.map((row) => ({
				ref: customRuleRef(row.id),
				enabled: row.enabled,
				config: {} as JsonValue,
				held: false,
			})),
		],
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
		if (deps.claimRunId) {
			await runServices.failRun(db, deps.claimRunId);
		}
		return none;
	}

	const headShaEarly =
		"changeRequest" in event ? event.changeRequest.headSha : null;
	/**
	 * Live progress: pin the real definition set and flip to running before
	 * the DAG walk so the run page can list planned rules and stream steps.
	 */
	const liveRunId =
		deps.claimRunId != null
			? ((await runServices.getRunById(db, deps.claimRunId))?.id ?? null)
			: null;
	if (liveRunId) {
		await runServices.beginRunEvaluation(db, liveRunId, {
			snapshot: matching,
			headSha: headShaEarly,
		});
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
		if (deps.claimRunId) {
			await runServices.failRun(db, deps.claimRunId);
		}
		return none;
	}

	// Hold the merge button only once evaluation is actually about to run.
	await deps.onBeforeEvaluate?.();

	const customSignals: CustomRuleSource = customRuleSource(
		customRows,
		deps.signalHttp
			? createForgeSignalCtx({ forge: deps.signalHttp, event, now })
			: null,
	);
	const evaluateRuleRef = makeEvaluator(ctx, logger, customSignals);
	const executions: {
		definition: WorkflowDefinition;
		result: Awaited<ReturnType<typeof executeWorkflow>>;
	}[] = [];
	try {
		for (const definition of matching) {
			executions.push({
				definition,
				result: await executeWorkflow({
					definition,
					event,
					evaluateRuleRef,
					now: () => new Date().toISOString(),
					// Stream each finished step onto the pre-materialized run so the
					// run page can list completed checks as the DAG walks.
					onStep: liveRunId
						? async (step) => {
								const projected = withPublicProjection(
									[
										{
											...step,
											nodeId: `${definition.id}:${step.nodeId}`,
										},
									],
									customSignals.records,
								);
								await runServices.recordSteps(db, liveRunId, projected);
							}
						: undefined,
				}),
			});
		}
	} catch (error) {
		if (liveRunId) {
			await runServices.failRun(db, liveRunId);
		}
		throw error;
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
	 * skipped ≥ 50% of rule nodes ⇒ needs_review, routed to moderation. The
	 * `disabled` status no longer occurs (workflow rules always evaluate); the
	 * filter stays as a cheap guard for any historical step shape.
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
		const degradationStep: StepRecord = {
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
		};
		steps.push(degradationStep);
		if (liveRunId) {
			await runServices.recordSteps(
				db,
				liveRunId,
				withPublicProjection([degradationStep]),
			);
		}
		logger.warn(
			{ degradedReads, skippedCount, ruleNodes: ruleSteps0.length },
			"evaluation degraded — fail-closed floor routes run to moderation",
		);
	}

	const headSha = "changeRequest" in event ? event.changeRequest.headSha : null;
	const subjectNumber =
		"changeRequest" in event ? event.changeRequest.number : null;
	const terminalStatus = paused ? "paused" : "completed";
	let runId: string;
	if (liveRunId) {
		runId = liveRunId;
		await runServices.finalizeRun(db, runId, {
			headSha,
			snapshot: matching,
			status: terminalStatus,
			verdict,
		});
		// Steps already streamed via onStep — do not insert them again.
	} else {
		// Missing claim row (legacy job or race) — create as a normal run.
		runId = await runServices.createRun(db, {
			eventId,
			repoFullName: event.repo.fullName,
			subjectNumber,
			headSha,
			snapshot: matching,
			status: terminalStatus,
			verdict,
			triggeredBy: deps.triggeredBy ?? null,
		});
		await runServices.recordSteps(
			db,
			runId,
			withPublicProjection(steps, customSignals.records),
		);
	}

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

export function withPublicProjection(
	steps: StepRecord[],
	customRecords?: Map<string, CustomRuleRecord>,
): PersistStep[] {
	return steps.map((step) => {
		if (step.nodeKind !== "rule" || !step.ruleRef) {
			return step;
		}
		const envelope = step.output;
		const inner =
			envelope && typeof envelope === "object" && "evidence" in envelope
				? (envelope as { evidence: unknown }).evidence
				: null;
		const stored = customRecords?.get(step.ruleRef);
		if (stored) {
			// Custom rules project generically: the observed value is public
			// (it is the contributor's own footprint); the configured threshold
			// lives in comparison args and never reaches evidence (§10).
			const observed =
				inner && typeof inner === "object" && "observed" in inner
					? (inner as { observed: unknown }).observed
					: null;
			return {
				...step,
				publicEvidence: observed === null ? null : { observed },
				summary:
					observed === null
						? null
						: customRuleSummary(stored.definition, observed),
			};
		}
		const { publicEvidence, summary } = projectRulePublic(step.ruleRef, inner);
		return { ...step, publicEvidence, summary };
	});
}

export function makeEvaluator(
	ctx: RuleContext,
	logger: Logger,
	custom?: CustomRuleSource,
) {
	return async (ref: string, config: unknown): Promise<RuleResult> => {
		const stored = custom?.records.get(ref);
		if (stored && custom) {
			try {
				return await evaluateCustomRule(stored, custom.signalCtx, ctx.now);
			} catch (error) {
				logger.error(
					{ ref, error: getErrorMessage(error) },
					"custom rule threw — treated as skipped (bug)",
				);
				return skippedResult(
					ref,
					`rule threw: ${getErrorMessage(error)}`,
					ctx.now,
				);
			}
		}
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
