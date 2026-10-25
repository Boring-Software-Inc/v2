import type {
	JsonValue,
	RepoScopedEvent,
	RuleResult,
	UsageSource,
	Verdict,
	WorkflowDefinition,
} from "@tripwire/contracts";
import {
	AI_REVIEW_RULE_ID,
	actionCommentMarker,
	type CustomRuleRecord,
	customRuleRef,
	customRuleSummary,
	isAiReviewNotRunStep,
	joinVerdicts,
	nonEnforcingRuleNodeIds,
	resolveEffectiveRuleConfig,
	ruleIdOf,
	ruleResultSchema,
	unrunnableIssues,
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
import {
	aiProviderServices,
	economicsServices,
	eventServices,
	moderationServices,
	repoServices,
	runServices,
} from "@tripwire/db";
import type { CommentReason, GithubHttp } from "@tripwire/forge-github";
import { createForgeSignalCtx } from "@tripwire/sdk";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
import { buildRuleContext, type WorkerReads } from "../context.ts";
import {
	exemptionFlagRefusedInProd,
	isExemptionDisabled,
} from "../exemption.ts";
import * as metering from "../metering.ts";
import { readsInjectionRefusedInProd } from "../reads-injection.ts";
import {
	type ReportAiCredits,
	type ReportUnrunnable,
	reportAiCreditsToSentry,
	reportUnrunnableToSentry,
} from "../report-unrunnable.ts";
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

export function actionPayload(
	action: { nodeId: string; action: string; params: Record<string, unknown> },
	definitionId: string,
	runId: string,
): Record<string, unknown> {
	return {
		...action.params,
		nodeId: `${definitionId}:${action.nodeId}`,
		...(action.action === "post-comment"
			? {
					marker: actionCommentMarker({
						workflowId: definitionId,
						nodeId: action.nodeId,
						runId,
					}),
				}
			: {}),
	};
}

export function postsSomething(action: { action: string }): boolean {
	return action.action !== "comment";
}

export function worstVerdict(verdicts: Verdict[]): Verdict {
	return joinVerdicts(verdicts);
}

export function floorStepsOf<
	T extends { nodeId: string; status: string; output: unknown },
>(definitions: readonly WorkflowDefinition[], ruleSteps: readonly T[]): T[] {
	const quiet = new Set(
		definitions.flatMap((definition) =>
			[...nonEnforcingRuleNodeIds(definition)].map(
				(nodeId) => `${definition.id}:${nodeId}`,
			),
		),
	);
	return floorRuleSteps(ruleSteps).filter((step) => !quiet.has(step.nodeId));
}

export function isEvaluationDegraded(
	ruleNodeCount: number,
	skippedCount: number,
): boolean {
	return ruleNodeCount > 0 && skippedCount * 2 >= ruleNodeCount;
}

/**
 * The fail-closed floor predicate (§6): a would-be PASS whose evaluation is
 * mostly guesswork must not silently wave through. One skipped rule still passes
 * (a flaky read can't block a human), but skipped rules at OR above 50% of the
 * active rule nodes routes the run to moderation instead. Pure so both sides of
 * the 50% line are unit-testable without a live run. Only escalates a `pass`.
 */
/**
 * The rule steps the fail-closed floor counts. AI review is a bonus: when it
 * does not run, the verdict comes from the other rules, and the run says AI
 * review did not run instead of going to human review.
 */
export function floorRuleSteps<T extends { status: string; output: unknown }>(
	ruleSteps: readonly T[],
): T[] {
	return ruleSteps.filter((step) => !isAiReviewNotRunStep(step));
}

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
	 * §4 backfill — false ⇒ persist the run/steps/verdict as history only: actions
	 * are `suppressed` (no comment, no check, no sweeper pickup), no review item
	 * opens, the run never pauses, and it never counts as the latest run that
	 * owns the change request's surfaces. Default true.
	 */
	surface?: boolean;
	/** Manual re-run: the triggering admin's user id, stamped on the run. */
	triggeredBy?: string;
	/**
	 * Pre-materialized run id (re-run enqueue). When set, finalize that row
	 * instead of inserting a new one — the activity card already points here.
	 */
	claimRunId?: string;
	/**
	 * Derived COGS source. When set, ai-review usage is metered best-effort after
	 * the run persists (a metering outage never touches the run). Omitted in unit
	 * tests, which skip metering.
	 */
	meterSource?: UsageSource;
	reportUnrunnable?: ReportUnrunnable;
	reportAiCredits?: ReportAiCredits;
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
	aiReviewNotRun?: boolean;
	quiet?: boolean;
}

/**
 * Public entry: run the workflows for an event inside a per-run metering counter
 * scope, so every GitHub and OpenRouter transport call attributes to this run.
 * The scope is a no-op when metering is off (the transport hooks just find no
 * store), so unit tests calling this are unaffected.
 */
export function runWorkflows(
	deps: RunWorkflowsDeps,
	event: RepoScopedEvent,
	eventId: string,
): Promise<RunWorkflowsResult> {
	return metering.runWithCounter(() => runWorkflowsInner(deps, event, eventId));
}

async function runWorkflowsInner(
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
	const repo = await repoServices.getRepoByFullName(
		db,
		event.repo.fullName,
		event.forge,
	);

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

	const stored = await repoServices.listEnabledWorkflows(
		db,
		event.repo.fullName,
		event.forge,
	);
	const checkedStored = stored.map((definition) => ({
		definition,
		issues: unrunnableIssues(definition),
	}));
	const custom = checkedStored.flatMap((entry) =>
		entry.issues.length === 0 ? [entry.definition] : [],
	);
	const broken = checkedStored.filter((entry) => entry.issues.length > 0);
	// Saved workflows orchestrate the rules they CONTAIN — they do not turn the
	// rest off. Rules outside every enabled workflow keep running standalone via
	// the derived default over the leftover toggles; owned rule ids are excluded
	// from the derivation so a rule never runs twice with two configs (the
	// workflow node's config wins for owned rules). With no saved workflow the
	// derived default runs alone, even trigger-only (all rules off ⇒ pass run).
	const ownedRuleIds = new Set(
		stored.flatMap((def) =>
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
			...ruleConfigs.map((config) => ({
				...resolveEffectiveRuleConfig({
					ruleId: config.ruleId,
					version: config.version,
					enabled: config.enabled,
					config: config.config as JsonValue,
				}),
				outcome: config.outcome,
			})),
			// Custom rules join the toggle set like any non-baseline rule: they
			// run when enabled, and workflow ownership excludes them like any id.
			...customRows.map((row) => ({
				ref: customRuleRef(row.id),
				enabled: row.enabled,
				config: {} as JsonValue,
				held: false,
				outcome: row.outcome,
			})),
		],
		ownedRuleIds,
		event.forge,
	);
	const derivedHasRules = derived.nodes.some((node) => node.type === "rule");
	const scheduled = event.kind === "schedule.matched" ? event : null;
	const definitions: WorkflowDefinition[] = scheduled
		? custom.filter((def) => def.id === scheduled.schedule.workflowId)
		: custom.length > 0
			? derivedHasRules
				? [...custom, derived]
				: custom
			: [derived];
	const triggeredBy = (def: WorkflowDefinition) =>
		def.nodes.some(
			(node) => node.type === "trigger" && node.kinds.includes(event.kind),
		);
	const matching = definitions.filter(triggeredBy);
	const unrunnable = broken.filter(
		(entry) =>
			triggeredBy(entry.definition) &&
			(!scheduled || entry.definition.id === scheduled.schedule.workflowId),
	);
	if (matching.length === 0 && unrunnable.length === 0) {
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
			eventId,
		});
	}

	const now = new Date().toISOString();
	const needsReads =
		!scheduled ||
		matching.some((def) => def.nodes.some((node) => node.type === "rule"));
	const { ctx, degradedReads } = await buildRuleContext(
		event,
		needsReads ? deps.reads : null,
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
		!scheduled &&
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
	const closedNow =
		"changeRequest" in event &&
		event.kind !== "change-request.closed" &&
		deps.surface !== false &&
		(await eventServices.changeRequestIsClosed(
			db,
			event.repo.fullName,
			event.changeRequest.number,
		));
	if (!closedNow) {
		await deps.onBeforeEvaluate?.();
	}

	const customSignals: CustomRuleSource = customRuleSource(
		customRows,
		deps.signalHttp
			? createForgeSignalCtx({ forge: deps.signalHttp, event, now })
			: null,
	);
	const evaluateRuleRef = makeEvaluator(ctx, logger, customSignals);
	const executions: Execution[] = [];
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
	let paused = executions.some((e) => e.result.pausedAtNodeIds.length > 0);
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
	const floorSteps = floorStepsOf(matching, ruleSteps0);
	const skippedCount = floorSteps.filter(
		(step) => step.status === "skipped",
	).length;
	if (closedNow) {
		const at = new Date().toISOString();
		const closedStep: StepRecord = {
			nodeId: "run:change-request-closed",
			nodeKind: "action",
			status: "skipped",
			input: { changeRequest: "closed" },
			output: {
				reason:
					"The change request is closed, so Tripwire recorded the result and took no action.",
			},
			startedAt: at,
			finishedAt: at,
			durationMs: 0,
		};
		steps.push(closedStep);
		if (liveRunId) {
			await runServices.recordSteps(db, liveRunId, [closedStep]);
		}
	}
	const closeHeld = closedNow
		? false
		: await holdCloses({
				db,
				event,
				executions,
				evaluationDegraded: isEvaluationDegraded(
					floorSteps.length,
					skippedCount,
				),
				steps,
			});
	if (closeHeld) {
		verdict = worstVerdict(executions.map((e) => e.result.verdict));
		paused = executions.some((e) => e.result.pausedAtNodeIds.length > 0);
		const heldStep = steps.at(-1);
		if (liveRunId && heldStep) {
			await runServices.recordSteps(db, liveRunId, [heldStep]);
		}
	}
	const degraded =
		isRunDegraded(floorSteps.length, skippedCount, verdict) ||
		closeHeld === "degraded";
	const unrunnableFloored = unrunnable.length > 0 && verdict === "pass";
	const aiReviewNotRun = ruleSteps0.some(isAiReviewNotRunStep);
	const floored = degraded || unrunnableFloored;
	const heldBack = floored && scheduled !== null;
	/**
	 * The floor is configurable, and ON by default.
	 *
	 * Turning it off lets a partly-evaluated run pass. It does NOT hide what
	 * happened: the step below is recorded either way, so the run page and
	 * the audit trail still name every rule that could not evaluate. Turning
	 * off a safety net must never turn off the evidence.
	 */
	const failClosed =
		floored &&
		!heldBack &&
		(await repoServices.getResponseConfig(db, repo.id)).failClosedFallback;
	if (failClosed) {
		verdict = joinVerdicts([verdict, "needs_review"]);
		paused = true;
	}
	if (unrunnable.length > 0) {
		const startedAt = new Date().toISOString();
		const unrunnableStep: StepRecord = {
			nodeId: "run:unrunnable",
			nodeKind: "gate",
			status: "skipped",
			input: { rule: "unrunnable workflow" },
			output: {
				workflows: unrunnable.map((entry) => ({
					id: entry.definition.id,
					name: entry.definition.name,
				})),
				issues: unrunnable.map((entry) => ({
					workflowId: entry.definition.id,
					messages: entry.issues.map((issue) => issue.message),
				})),
				enforced: unrunnableFloored && failClosed,
				tookNoAction: heldBack,
			},
			startedAt,
			finishedAt: startedAt,
			durationMs: 0,
		};
		steps.push(unrunnableStep);
		if (liveRunId) {
			await runServices.recordSteps(db, liveRunId, [unrunnableStep]);
		}
		for (const entry of unrunnable) {
			logger.error(
				{
					workflowId: entry.definition.id,
					issues: entry.issues.map((issue) => issue.message),
				},
				"live workflow has wiring the executor cannot run",
			);
			(deps.reportUnrunnable ?? reportUnrunnableToSentry)({
				repo: event.repo.fullName,
				forge: event.forge,
				workflowId: entry.definition.id,
				lintRule: entry.issues[0]?.rule ?? "unknown",
				scheduled: scheduled !== null,
				messages: entry.issues.map((issue) => issue.message),
			});
		}
	}
	if (degraded) {
		const startedAt = new Date().toISOString();
		const degradationStep: StepRecord = {
			nodeId: "run:degradation",
			nodeKind: "gate",
			status: "skipped",
			input: { rule: "fail-closed floor", enforced: failClosed },
			output: {
				degradedReads,
				skippedRules: skippedCount,
				ruleNodes: floorSteps.length,
				/** false ⇒ the run passed with a partial evaluation, on purpose. */
				enforced: failClosed,
				...(heldBack ? { tookNoAction: true } : {}),
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
			{
				degradedReads,
				skippedCount,
				ruleNodes: floorSteps.length,
				enforced: failClosed,
			},
			heldBack
				? "evaluation degraded — scheduled run takes no action"
				: failClosed
					? "evaluation degraded — fail-closed floor routes run to moderation"
					: "evaluation degraded — floor is off for this repo, run passes partial",
		);
	}

	const headSha = "changeRequest" in event ? event.changeRequest.headSha : null;
	/**
	 * A COMMENT names its change request too, in `comment.subjectNumber`. Taking
	 * it only from a change-request event stored null for every comment-triggered
	 * run, and this column is load-bearing in three places:
	 *
	 *   - the run page's deep link to the change request it judged
	 *   - `canRerun` (§6 — a re-run needs a subject to target)
	 *   - `sweep-actions`, which SKIPS actions whose subject is null, so a
	 *     recorded block or comment was never delivered and the give-up window
	 *     eventually abandoned it
	 *
	 * There is no head sha on a comment: it judges the thread, not a commit.
	 */
	const subjectNumber =
		"changeRequest" in event
			? event.changeRequest.number
			: "comment" in event
				? event.comment.subjectNumber
				: scheduled
					? scheduled.thread.number
					: null;
	const backfill = deps.surface === false;
	const silent = backfill || closedNow;
	const terminalStatus = paused && !silent ? "paused" : "completed";
	let runId: string;
	if (liveRunId) {
		runId = liveRunId;
		await runServices.finalizeRun(db, runId, {
			eventId,
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
			subjectKind: scheduled ? scheduled.thread.kind : null,
			headSha,
			snapshot: matching,
			status: terminalStatus,
			verdict,
			triggeredBy: deps.triggeredBy ?? null,
			backfill,
		});
		await runServices.recordSteps(
			db,
			runId,
			withPublicProjection(steps, customSignals.records),
		);
	}

	for (const execution of silent ? [] : executions) {
		for (const pausedNodeId of execution.result.pausedAtNodeIds) {
			await moderationServices.createModerationItem(db, {
				runId,
				nodeId: `${execution.definition.id}:${pausedNodeId}`,
			});
		}
	}
	if (
		!silent &&
		((degraded && !heldBack) || (unrunnableFloored && failClosed))
	) {
		await moderationServices.createModerationItem(db, {
			runId,
			nodeId: "run:degraded",
		});
	}

	const actionRows = await runServices.recordActions(
		db,
		runId,
		executions.flatMap((execution) =>
			(heldBack ? [] : execution.result.actions.filter(postsSomething)).map(
				(action) => ({
					kind: action.action,
					payload: actionPayload(action, execution.definition.id, runId),
					idempotencyKey: `${action.action}:${execution.definition.id}:${action.nodeId}`,
				}),
			),
		),
		silent ? "suppressed" : "recorded",
	);

	const reasons = buildCommentReasons(steps, customSignals.records);
	logger.info({ runId, verdict, paused, steps: steps.length }, "run persisted");
	await noteAiCredits(deps, ruleSteps0, event.repo.fullName);

	// Best-effort metering (economics-surface-contracts.md): record ai-review
	// usage and the per-run resource counters AFTER the run persists. A failure
	// here is logged and swallowed — the run outcome is already committed and
	// must never depend on metering.
	if (deps.meterSource) {
		try {
			await economicsServices.recordRunAiReviewUsage(db, {
				runId,
				orgId: repo?.orgId ?? null,
				source: deps.meterSource,
			});
			const counter = metering.getCounter();
			const activeMs = steps.reduce((sum, step) => sum + step.durationMs, 0);
			await economicsServices.recordUsageCounters(db, {
				runId,
				orgId: repo?.orgId ?? null,
				githubApiCalls: counter?.githubApiCalls ?? 0,
				githubBytesIn: counter?.githubBytesIn ?? 0,
				githubBytesOut: counter?.githubBytesOut ?? 0,
				openrouterBytesOut: counter?.openrouterBytesOut ?? 0,
				activeMs,
			});
		} catch (error) {
			logger.warn(
				{ runId, error: getErrorMessage(error) },
				"metering failed — run unaffected",
			);
		}
	}
	return {
		runId,
		verdict,
		paused,
		actionRows,
		reasons,
		degraded,
		aiReviewNotRun,
		...(closedNow ? { quiet: true } : {}),
	};
}

export type CloseHold = false | "degraded" | "reopened";

type Execution = {
	definition: WorkflowDefinition;
	result: Awaited<ReturnType<typeof executeWorkflow>>;
};

export function executionVerdict(result: Execution["result"]): Verdict {
	return joinVerdicts([
		...result.actions.map((action): Verdict => {
			if (action.action === "close") {
				return "close";
			}
			if (action.action === "block") {
				return "block";
			}
			return action.action === "request-fix" ? "changes_required" : "pass";
		}),
		result.pausedAtNodeIds.length > 0 ? "needs_review" : "pass",
	]);
}

export function applyCloseHold(
	executions: readonly Execution[],
	hold: Exclude<CloseHold, false>,
): void {
	for (const execution of executions) {
		const closes = execution.result.actions.some(
			(action) => action.action === "close",
		);
		if (!closes) {
			continue;
		}
		execution.result.actions = execution.result.actions.flatMap((action) => {
			if (action.action !== "close") {
				return [action];
			}
			return hold === "reopened"
				? [{ nodeId: action.nodeId, action: "block", params: {} }]
				: [];
		});
		execution.result.verdict = executionVerdict(execution.result);
	}
}

async function holdCloses(input: {
	db: Db;
	event: RepoScopedEvent;
	executions: readonly Execution[];
	evaluationDegraded: boolean;
	steps: StepRecord[];
}): Promise<CloseHold> {
	const { event } = input;
	if (
		!("changeRequest" in input.event) ||
		!input.executions.some((execution) =>
			execution.result.actions.some((action) => action.action === "close"),
		)
	) {
		return false;
	}
	const changeRequest = "changeRequest" in event ? event.changeRequest : null;
	const hold: CloseHold = input.evaluationDegraded
		? "degraded"
		: changeRequest &&
				(await runServices.closedOnHead(
					input.db,
					event.repo.fullName,
					changeRequest.number,
					changeRequest.headSha,
				))
			? "reopened"
			: false;
	if (!hold) {
		return false;
	}
	applyCloseHold(input.executions, hold);
	const at = new Date().toISOString();
	input.steps.push({
		nodeId: "run:close-held",
		nodeKind: "action",
		status: "skipped",
		input: { action: "close", hold },
		output: {
			reason:
				hold === "degraded"
					? "Too few checks could run, so Tripwire did not close it."
					: "A person reopened it on this commit, so Tripwire blocks instead of closing again.",
		},
		startedAt: at,
		finishedAt: at,
		durationMs: 0,
	});
	return hold;
}

interface CausedStep {
	status: string;
	output: unknown;
}

const stepCauseSchema = ruleResultSchema.pick({ cause: true });

export function isAiOutOfCreditsStep(step: CausedStep): boolean {
	return (
		step.status === "skipped" &&
		stepCauseSchema.safeParse(step.output).data?.cause === "ai-out-of-credits"
	);
}

function isAiReviewStep(step: StepRecord): boolean {
	return step.ruleRef?.startsWith(`${AI_REVIEW_RULE_ID}@`) === true;
}

async function noteAiCredits(
	deps: RunWorkflowsDeps,
	ruleSteps: StepRecord[],
	repo: string,
): Promise<void> {
	const out = ruleSteps.some(isAiOutOfCreditsStep);
	const reviewed = ruleSteps.some(
		(step) => isAiReviewStep(step) && step.status !== "skipped",
	);
	if (!(out || reviewed)) {
		return;
	}
	try {
		if (out) {
			const { changed } = await aiProviderServices.recordAiCredits(
				deps.db,
				"out",
			);
			if (changed) {
				deps.logger.error({ repo }, "AI provider is out of credits");
				(deps.reportAiCredits ?? reportAiCreditsToSentry)({ source: repo });
			}
			return;
		}
		if ((await aiProviderServices.getAiCredits(deps.db)) === "out") {
			await aiProviderServices.recordAiCredits(deps.db, "ready");
			deps.logger.info({ repo }, "AI provider has credits again");
		}
	} catch (error) {
		deps.logger.warn(
			{ error: getErrorMessage(error) },
			"recording AI credit state failed, run unaffected",
		);
	}
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
		const reason =
			envelope && typeof envelope === "object" && "reason" in envelope
				? (envelope as { reason?: unknown }).reason
				: undefined;
		const stored = customRecords?.get(step.ruleRef);
		let publicEvidence: unknown;
		let summary: string | null;
		if (stored) {
			// Custom rules project generically: the observed value is public
			// (it is the contributor's own footprint); the configured threshold
			// lives in comparison args and never reaches evidence (§10).
			const observed =
				inner && typeof inner === "object" && "observed" in inner
					? (inner as { observed: unknown }).observed
					: null;
			publicEvidence = observed === null ? null : { observed };
			summary =
				observed === null
					? null
					: customRuleSummary(stored.definition, observed);
		} else {
			({ publicEvidence, summary } = projectRulePublic(
				step.ruleRef,
				inner,
				step.status === "pass",
			));
		}
		// A skipped step carries no evidence; surface WHY (a skip with no reason
		// is invisible failure — the class that let custom rules sit inert). The
		// reason is sanitized so a thrown-rule stack trace or a schema error never
		// reaches a contributor (§10); the raw reason stays on the gated output.
		if (
			summary === null &&
			step.status === "skipped" &&
			typeof reason === "string"
		) {
			summary = publicSkipReason(reason);
		}
		return { ...step, publicEvidence, summary };
	});
}

/**
 * The public one-liner for a skipped rule step. Curated operational reasons
 * ("the change's diff is unavailable", "contributor profile unavailable") read
 * fine to a contributor and pass through. Bug-class / internal reasons — a rule
 * that threw, a schema mismatch, an invalid config, the ai-review muzzle — would
 * read like a stack trace on a public PR, so they collapse to a generic line
 * (§10). The verbatim reason is still on the maintainer-only `output` envelope.
 */
const INTERNAL_SKIP_REASON =
	/^rule threw|^unknown rule|failed schema|^invalid config|muzzle/i;
export function publicSkipReason(reason: string): string {
	return INTERNAL_SKIP_REASON.test(reason)
		? "Tripwire could not check this rule."
		: reason;
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
				return await evaluateCustomRule(
					stored,
					custom.signalCtx,
					ctx.now,
					ctx.event.forge,
				);
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
