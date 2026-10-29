import { createHash } from "node:crypto";
import type { Forge } from "@tripwire/contracts";
import {
	type CheckState,
	type CommentReason,
	checkSummary,
	forgePostsReviews,
	GITCAFE_VERDICT_ACTION_KINDS,
	type GitCafeEvaluationPhase,
	gitCafeActionPayloadSchema,
	gitCafeReviewerRefSchema,
	isAiReviewNotRunStep,
	labelParamsSchema,
	lockParamsSchema,
	type NormalizedEvent,
	planSurfaces,
	postCommentParamsSchema,
	REVIEW_POINTER,
	redactCommentReasons,
	redactionLevelFor,
	requestReviewTargetsSchema,
	type ScheduledThread,
	type SurfacePlan,
	type Verdict,
	verdictSchema,
	type WebhookPayload,
	wantsCheck,
} from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import {
	gitCafeActionServices,
	moderationServices,
	repoServices,
	responseServices,
	runServices,
} from "@tripwire/db";
import type { ForgeAction, ForgeAdapter } from "@tripwire/forge";
import { PENDING_CHECK_SUMMARY } from "@tripwire/forge-github";
import {
	getErrorMessage,
	pendingCheckIsStale,
	supersededBy,
} from "@tripwire/utils";
import type { Logger } from "pino";
import { buildCommentReasons } from "./comment-reasons.ts";
import { customRuleSource } from "./custom-rules.ts";
import { loadRunIssues } from "./run-issues.ts";

/** Recovery uses the committed evaluation, never a new verdict or a second AI call. */
export async function recoverGitCafeRunSurface(
	deps: PrSurfaceDeps,
	runId: string,
	event: NormalizedEvent,
	options?: Pick<EmitSurfaceInput, "pendingCheckPosted" | "rerun"> & {
		refreshId?: string;
	},
): Promise<boolean> {
	const state = await runServices.getGitCafeRunSurfaceState(deps.db, runId);
	const saved = state?.saved;
	const verdict = verdictSchema.safeParse(saved?.run.verdict);
	if (
		!saved ||
		!state ||
		!verdict.success ||
		event.forge !== "gitcafe" ||
		!("repo" in event) ||
		saved.run.repoFullName !== event.repo.fullName ||
		!["completed", "paused", "closed"].includes(saved.run.status)
	)
		return false;
	if (saved.run.status === "closed") return true;
	const surfaceKey = `evaluation:${createHash("sha256").update(JSON.stringify(state.phase)).digest("hex")}${options?.refreshId ? `:refresh:${options.refreshId}` : ""}`;
	const repo = await repoServices.getRepoByFullName(
		deps.db,
		event.repo.fullName,
		event.forge,
	);
	const records = customRuleSource(
		repo ? await repoServices.listCustomRules(deps.db, repo.id) : [],
		null,
	).records;
	const items = await moderationServices.listModerationItemsForRun(
		deps.db,
		runId,
	);
	const restoredEvent =
		"changeRequest" in event && saved.run.headSha
			? {
					...event,
					changeRequest: { ...event.changeRequest, headSha: saved.run.headSha },
				}
			: event;
	const recorded = saved.actions
		.filter((action) => action.status === "recorded")
		.map((action) => ({
			id: action.id,
			kind: action.kind,
			payload: gitCafeActionPayloadSchema.parse(action.payload),
		}));
	const hasCurrentSurface = saved.actions.some((action) => {
		if (surfaceKey && !action.idempotencyKey.endsWith(`:${surfaceKey}`))
			return false;
		const payload = gitCafeActionPayloadSchema.parse(action.payload);
		return action.kind === "set-check"
			? payload.conclusion === VERDICT_TO_CONCLUSION[verdict.data] &&
					payload.sha === saved.run.headSha
			: (action.kind === "comment" || action.kind === "dismiss-review") &&
					payload.verdict === verdict.data;
	});
	if (hasCurrentSurface && "changeRequest" in restoredEvent) {
		await executeRecordedPrActions(deps, {
			runId,
			event: restoredEvent,
			verdict: verdict.data,
			reasons: [],
			pendingActionRows: recorded,
			gitCafePhase: state.phase,
		});
		return true;
	}
	await emitPrSurface(deps, {
		runId,
		event: restoredEvent,
		verdict: verdict.data,
		reasons: buildCommentReasons(saved.steps, records),
		degraded: items.some((item) => item.nodeId === "run:degraded"),
		aiReviewNotRun: saved.steps.some(isAiReviewNotRunStep),
		pendingActionRows: recorded,
		pendingCheckPosted:
			options?.pendingCheckPosted ||
			saved.actions.some((action) => action.kind === "set-check"),
		surfaceKey,
		gitCafePhase: state.phase,
		refreshReview:
			options?.refreshId !== undefined &&
			verdict.data === "block" &&
			saved.run.subjectNumber !== null &&
			(await runServices.getActiveBlockReviewId(
				deps.db,
				{ forge: "gitcafe", fullName: saved.run.repoFullName },
				saved.run.subjectNumber,
			)) !== null,
		rerun: options?.rerun || saved.run.triggeredBy !== null,
		resumedFrom: [...saved.actions].reverse().flatMap((action) => {
			const parsed = verdictSchema.safeParse(
				gitCafeActionPayloadSchema.parse(action.payload).verdict,
			);
			return parsed.success ? [parsed.data] : [];
		})[0],
	});
	return true;
}

/**
 * §5.13 + §7: the two PR artifacts — ONE upserted comment (the face) and ONE
 * `tripwire` check per head SHA (the gate) — emitted from the same
 * persistence step so they can never disagree. Both are recorded as action
 * rows FIRST (§5.12) and marked executed after.
 */

export const VERDICT_TO_CONCLUSION: Record<Verdict, CheckState["conclusion"]> =
	{
		pass: "success",
		block: "failure",
		changes_required: "failure",
		needs_review: "pending",
		close: "failure",
	};

export const VERDICT_ONLY_KINDS: ReadonlySet<string> = new Set([
	"request-fix",
	"note",
]);

export const CLOSE_PREREQUISITES: ReadonlySet<string> = new Set([
	"comment",
	"delete-comment",
	"set-check",
]);

export interface PrSurfaceDeps {
	db: Db;
	adapter: ForgeAdapter | null;
	logger: Logger;
	/** Base URL for run deep links, e.g. https://tripwire.sh or localhost web. */
	appUrl: string;
}

/** §5.6b — hold the merge button DURING evaluation, not just after. */
export async function emitPendingCheck(
	deps: PrSurfaceDeps,
	event: NormalizedEvent,
	eventId?: string,
): Promise<boolean> {
	if (!deps.adapter || !("changeRequest" in event)) {
		return false;
	}
	if (eventId) {
		const latest = await runServices.getLatestRunForChangeRequest(
			deps.db,
			{ forge: event.forge, fullName: event.repo.fullName },
			event.changeRequest.number,
		);
		if (pendingCheckIsStale(latest, eventId, event.changeRequest.headSha)) {
			deps.logger.info(
				{ eventId, latestRunId: latest?.id },
				"pending check skipped, a newer event already owns this head",
			);
			return false;
		}
	}
	const repoRow = await repoServices.getRepoByFullName(
		deps.db,
		event.repo.fullName,
		event.forge,
	);
	const responseConfig = await repoServices.getResponseConfig(
		deps.db,
		repoRow?.id ?? null,
	);
	if (responseConfig.onSuccess === "silent") {
		return false;
	}
	try {
		const result = await deps.adapter.execute(
			{
				kind: "set-check",
				repoFullName: event.repo.fullName,
				check: {
					sha: event.changeRequest.headSha,
					conclusion: "pending",
					summary: PENDING_CHECK_SUMMARY,
					detailsUrl: deps.appUrl,
				},
			},
			{ eventId: eventId ?? event.id },
		);
		if ("refused" in result) {
			deps.logger.warn(
				{ eventId, reason: result.reason, status: result.status },
				"pending check refused",
			);
			return false;
		}
		return true;
	} catch (error) {
		deps.logger.warn(
			{ error: getErrorMessage(error) },
			"pending check emission failed",
		);
		return false;
	}
}

export interface EmitSurfaceInput {
	runId: string;
	verdict: Verdict;
	event: NormalizedEvent;
	/** The failing rules' reasons → the comment body (never a rule count, §12). */
	reasons: CommentReason[];
	/** Fail-closed floor fired — the headline names the degradation. */
	degraded?: boolean;
	/** Manual re-run — the comment carries the re-evaluation note. */
	rerun?: boolean;
	aiReviewNotRun?: boolean;
	resumedFrom?: Verdict;
	surfaceKey?: string;
	pendingCheckPosted?: boolean;
	gitCafePhase?: GitCafeEvaluationPhase;
	refreshReview?: boolean;
	/** Workflow-emitted action rows still awaiting execution. */
	pendingActionRows: {
		id: string;
		kind: string;
		payload: Record<string, unknown>;
	}[];
}

export async function emitPrSurface(
	deps: PrSurfaceDeps,
	input: EmitSurfaceInput,
): Promise<void> {
	const { db, adapter, logger } = deps;
	const { event, runId, verdict } = input;
	if (event.forge === "gitcafe" && !input.gitCafePhase) {
		if (!(await recoverGitCafeRunSurface(deps, runId, event, input)))
			throw new Error(
				"Committed GitCafe evaluation cannot recover its surfaces",
			);
		return;
	}
	if (event.kind === "schedule.matched") {
		const { thread } = event;
		await emitThreadActions(deps, input, {
			number: thread.number,
			title: thread.title,
			author: thread.author,
			skips: (kind) => SCHEDULED_SKIPS[kind]?.(thread) === true,
		});
		return;
	}
	if (event.kind === "comment.created") {
		await emitThreadActions(deps, input, {
			number: event.comment.subjectNumber,
			title: "",
			author: event.actor.login,
			skips: () => false,
		});
		return;
	}
	if (!("changeRequest" in event)) {
		return;
	}
	const repoFullName = event.repo.fullName;
	const number = event.changeRequest.number;
	const sha = event.changeRequest.headSha;
	const runUrl = `${deps.appUrl}/runs/${runId}`;
	const { reasons, issues } = await loadRunIssues(db, runId, input.reasons);

	// The verdict the PR already shows — drives the resolution copy AND whether a
	// stale request-changes review must be dismissed (§7).
	const previousVerdict =
		input.resumedFrom ??
		(await runServices.getPreviousVerdict(
			db,
			{ forge: event.forge, fullName: repoFullName },
			number,
			runId,
		));
	// A block that just cleared ⇒ dismiss its outstanding request-changes review
	// (it can't self-edit and would keep gating merge on required-review repos).
	const reviewToDismiss =
		verdict !== "block"
			? await runServices.getActiveBlockReviewId(
					db,
					{ forge: event.forge, fullName: repoFullName },
					number,
				)
			: null;

	// The repo's response config (customize) decides which surfaces post. A
	// verdict TRANSITION updates a comment that is already there even when the
	// config says silent, so a stale "blocked" never outlives its verdict (§7).
	const repoRow = await repoServices.getRepoByFullName(
		db,
		repoFullName,
		event.forge,
	);
	const responseConfig = await repoServices.getResponseConfig(
		db,
		repoRow?.id ?? null,
	);
	const policy = await responseServices.getRedactionPolicy(
		db,
		repoRow?.id ?? null,
	);
	const blockRows =
		verdict === "close"
			? []
			: input.pendingActionRows.filter((row) => row.kind === "block");
	const plan = planSurfaces(
		{
			verdict,
			contributorLogin: event.actor.login,
			reasons,
			runUrl,
			degraded: input.degraded,
			previousVerdict,
			rerun: input.rerun,
			aiReviewNotRun: input.aiReviewNotRun,
			title: event.changeRequest.title,
			targetBranch: event.changeRequest.baseRef ?? null,
			...issues,
		},
		responseConfig,
		policy,
		{
			reviewPosted:
				(blockRows.length > 0 || input.refreshReview === true) &&
				forgePostsReviews(event.forge),
		},
	);
	const review = plan.review ?? REVIEW_POINTER.block;
	for (const row of blockRows) {
		const operation =
			event.forge === "gitcafe"
				? gitCafeActionPayloadSchema.parse(row.payload).gitCafeOperation
				: undefined;
		const body =
			operation?.command.kind === "review"
				? operation.command.input.body
				: review;
		row.payload = { ...row.payload, reason: body };
		if (event.forge !== "gitcafe")
			await runServices.stampReviewBody(db, row.id, body);
	}
	const includeCheck =
		wantsCheck(responseConfig, verdict) || input.pendingCheckPosted === true;

	const intents: runServices.RecordActionInput[] = [
		...(input.refreshReview && verdict === "block"
			? [
					{
						kind: "block",
						payload: { reason: review },
						idempotencyKey: `refresh-review:${input.surfaceKey}`,
					},
				]
			: []),
		...commentRows(plan, number, verdict, previousVerdict).map((row) =>
			input.surfaceKey
				? {
						...row,
						idempotencyKey: `${row.idempotencyKey}:${input.surfaceKey}`,
					}
				: row,
		),
		...(includeCheck
			? [
					{
						kind: "set-check",
						payload: {
							sha,
							conclusion: VERDICT_TO_CONCLUSION[verdict],
							summary: checkSummary(
								verdict,
								reasons,
								input.degraded,
								redactionLevelFor(policy, "check"),
								input.aiReviewNotRun,
								issues,
							),
							detailsUrl: runUrl,
						},
						idempotencyKey: input.surfaceKey
							? `check:${sha}:${verdict}:${input.surfaceKey}`
							: `check:${sha}:${verdict}`,
					},
				]
			: []),
		...(reviewToDismiss || (event.forge === "gitcafe" && verdict !== "block")
			? [
					{
						kind: "dismiss-review",
						payload: {
							number,
							reviewId: reviewToDismiss,
							verdict: event.forge === "gitcafe" ? verdict : undefined,
						},
						idempotencyKey:
							event.forge === "gitcafe"
								? `dismiss-review:${reviewToDismiss ?? "all-owned"}:${verdict}:${input.surfaceKey ?? "initial"}`
								: `dismiss-review:${reviewToDismiss}`,
					},
				]
			: []),
	];
	const surfaceRows = input.gitCafePhase
		? await runServices.recordGitCafeSurfaceActions(
				db,
				runId,
				input.gitCafePhase,
				intents,
				input.pendingActionRows
					.filter((row) => GITCAFE_VERDICT_ACTION_KINDS.has(row.kind))
					.map((row) => row.id),
				blockRows.map((row) => ({
					id: row.id,
					body: String(row.payload.reason),
				})),
			)
		: await runServices.recordActions(db, runId, intents);
	if (surfaceRows === null) return;

	// Outbound delivery (webhook/discord) is independent of GitHub — build and
	// attach each row's payload here (we have the run context + appUrl), leave
	// it `recorded`, and let the deliver-webhook job POST it through the guard.
	// This runs BEFORE the forge guard so webhooks fire even with no GitHub
	// credentials.
	for (const row of input.pendingActionRows) {
		if (row.kind !== "webhook" && row.kind !== "discord") {
			continue;
		}
		const delivery: WebhookPayload = {
			version: 1,
			verdict,
			org: repoFullName.split("/")[0] ?? repoFullName,
			repo: repoFullName,
			changeRequest: {
				number,
				title: event.changeRequest.title,
				author: event.actor.login,
			},
			firedRules: firedRulesFor(reasons, redactionLevelFor(policy, "webhook")),
			runUrl,
			timestamp: new Date().toISOString(),
		};
		await runServices.attachDeliveryPayload(db, row.id, delivery);
	}

	if (!adapter) {
		logger.warn(
			{ runId },
			"no forge credentials — actions recorded, not executed",
		);
		return;
	}
	await executeRecordedPrActions(
		deps,
		{
			...input,
			pendingActionRows: [...input.pendingActionRows, ...surfaceRows],
		},
		review,
	);
}

async function executeRecordedPrActions(
	deps: PrSurfaceDeps,
	input: EmitSurfaceInput,
	review: string = REVIEW_POINTER.block,
): Promise<void> {
	const { db, adapter, logger } = deps;
	const { event, runId, verdict } = input;
	if (!adapter || !("changeRequest" in event)) return;
	const repoFullName = event.repo.fullName;
	const number = event.changeRequest.number;
	const sha = event.changeRequest.headSha;
	let activeReviewId = await runServices.getActiveBlockReviewId(
		db,
		{ forge: event.forge, fullName: repoFullName },
		number,
	);

	/**
	 * Comment ownership (§6 — live finding): the comment is per-PR but runs are
	 * per-SHA. Only the LATEST run for the change request may execute its
	 * comment — otherwise an out-of-order decision on an older run upserts a
	 * stale comment over the current one. Non-latest runs still emit their
	 * per-SHA check (correct and harmless); their comment is superseded.
	 */
	const latestRun = await runServices.getLatestRunForChangeRequest(
		db,
		{ forge: event.forge, fullName: repoFullName },
		number,
	);
	const latestRunId = latestRun?.id ?? null;

	const cleanup =
		event.forge === "gitcafe"
			? await gitCafeActionServices.getPendingGitCafeReviewCleanup(db, runId)
			: [];
	const unique = new Map(
		[...cleanup, ...input.pendingActionRows].map((row) => [row.id, row]),
	);
	const ordered = [...unique.values()].sort(
		(a, b) =>
			(event.forge === "gitcafe"
				? Number(b.kind === "dismiss-review") -
					Number(a.kind === "dismiss-review")
				: 0) || Number(a.kind === "close") - Number(b.kind === "close"),
	);
	let surfaceFailed = false;
	for (const row of ordered) {
		if (
			event.forge === "gitcafe" &&
			((row.kind === "set-check" &&
				row.payload.conclusion !== VERDICT_TO_CONCLUSION[verdict]) ||
				((row.kind === "comment" || row.kind === "dismiss-review") &&
					row.payload.verdict !== undefined &&
					row.payload.verdict !== verdict) ||
				(row.kind === "block" && verdict !== "block"))
		) {
			await runServices.markActionSuperseded(db, row.id);
			continue;
		}
		// Outbound delivery is handled above + by the deliver-webhook job, not
		// through the forge adapter.
		if (row.kind === "webhook" || row.kind === "discord") {
			continue;
		}
		// Ownership (§6): only the latest run writes to the shared PR — the comment,
		// the review AND the review dismissal. A stale run must not post a
		// transition, request changes, or dismiss the current run's review.
		if (supersededBy(row.kind, { id: runId, headSha: sha }, latestRun)) {
			await runServices.markActionSuperseded(db, row.id);
			logger.info(
				{ runId, latestRunId, number, sha, kind: row.kind },
				"action superseded, a newer run owns this change request",
			);
			continue;
		}
		if (VERDICT_ONLY_KINDS.has(row.kind)) {
			await runServices.markActionExecuted(db, row.id, null);
			continue;
		}
		if (row.kind === "close" && surfaceFailed) {
			logger.warn(
				{ runId, actionId: row.id },
				"close waits, its comment or check did not post",
			);
			continue;
		}
		if (
			event.forge === "gitcafe" &&
			row.kind === "set-check" &&
			row.payload.conclusion === "success" &&
			!(await runServices.isReviewCleanupComplete(db, runId))
		)
			continue;
		if (row.kind === "block" && verdict === "close") {
			await runServices.markActionSuperseded(db, row.id);
			continue;
		}
		const forgeAction = toForgeAction(
			row,
			repoFullName,
			number,
			review,
			activeReviewId,
		);
		try {
			const result = await adapter.execute(forgeAction, { actionId: row.id });
			if ("refused" in result) {
				if (CLOSE_PREREQUISITES.has(row.kind)) surfaceFailed = true;
				logger.warn(
					{
						actionId: row.id,
						kind: row.kind,
						reason: result.reason,
						status: result.status,
					},
					"forge action refused, row stays recorded for retry",
				);
				continue;
			}
			await runServices.markActionExecuted(db, row.id, result.externalId);
			if (row.kind === "block" && result.externalId) {
				activeReviewId = result.externalId;
			}
		} catch (error) {
			if (CLOSE_PREREQUISITES.has(row.kind)) {
				surfaceFailed = true;
			}
			logger.error(
				{ actionId: row.id, kind: row.kind, error: getErrorMessage(error) },
				"action execution failed — row stays recorded for retry",
			);
		}
	}
}

const SCHEDULED_SKIPS: Record<string, (thread: ScheduledThread) => boolean> = {
	block: () => true,
	"request-review": (thread) => thread.kind !== "change-request",
};

async function emitThreadActions(
	deps: PrSurfaceDeps,
	input: EmitSurfaceInput,
	thread: {
		number: number;
		title: string;
		author: string;
		skips: (kind: string) => boolean;
	},
): Promise<void> {
	const { db, adapter, logger } = deps;
	const { event, runId, verdict } = input;
	if (!("repo" in event)) {
		return;
	}
	const repoFullName = event.repo.fullName;
	const runUrl = `${deps.appUrl}/runs/${runId}`;
	const policy = await responseServices.getRedactionPolicy(
		db,
		(await repoServices.getRepoByFullName(db, repoFullName, event.forge))?.id ??
			null,
	);
	for (const row of input.pendingActionRows) {
		if (row.kind !== "webhook") {
			continue;
		}
		const delivery: WebhookPayload = {
			version: 1,
			verdict,
			org: repoFullName.split("/")[0] ?? repoFullName,
			repo: repoFullName,
			changeRequest: {
				number: thread.number,
				title: thread.title,
				author: thread.author,
			},
			firedRules: firedRulesFor(
				input.reasons,
				redactionLevelFor(policy, "webhook"),
			),
			runUrl,
			timestamp: new Date().toISOString(),
		};
		await runServices.attachDeliveryPayload(db, row.id, delivery);
	}
	if (!adapter) {
		logger.warn(
			{ runId },
			"no forge credentials — thread actions recorded, not executed",
		);
		return;
	}
	for (const row of input.pendingActionRows) {
		if (row.kind === "webhook") {
			continue;
		}
		if (VERDICT_ONLY_KINDS.has(row.kind)) {
			await runServices.markActionExecuted(db, row.id, null);
			continue;
		}
		if (thread.skips(row.kind)) {
			await runServices.markActionSuperseded(db, row.id);
			logger.info(
				{ runId, kind: row.kind, thread: thread.number },
				"action does not apply to this thread",
			);
			continue;
		}
		try {
			const result = await adapter.execute(
				toForgeAction(row, repoFullName, thread.number, REVIEW_POINTER.block),
				{ actionId: row.id },
			);
			if ("refused" in result) {
				logger.warn(
					{
						actionId: row.id,
						kind: row.kind,
						reason: result.reason,
						status: result.status,
					},
					"thread action refused, row stays recorded for retry",
				);
				continue;
			}
			await runServices.markActionExecuted(db, row.id, result.externalId);
		} catch (error) {
			logger.error(
				{ actionId: row.id, kind: row.kind, error: getErrorMessage(error) },
				"thread action failed — row stays recorded for retry",
			);
		}
	}
}

interface CommentPayload {
	number: number;
	verdict: Verdict;
	previousVerdict: Verdict | null;
	body: string;
	onlyIfPresent?: boolean;
}

export function commentRows(
	plan: SurfacePlan,
	number: number,
	verdict: Verdict,
	previousVerdict: Verdict | null,
): runServices.RecordActionInput[] {
	if (plan.comment === "delete") {
		return [
			{
				kind: "delete-comment",
				payload: { number },
				idempotencyKey: `delete-comment:${number}`,
			},
		];
	}
	if (plan.comment === "none" || plan.commentBody === null) {
		return [];
	}
	const payload: CommentPayload = {
		number,
		verdict,
		previousVerdict,
		body: plan.commentBody,
	};
	if (plan.comment === "if-present") {
		payload.onlyIfPresent = true;
	}
	return [
		{
			kind: "comment",
			payload: { ...payload },
			idempotencyKey: `comment:${number}:${verdict}`,
		},
	];
}

export function firedRulesFor(
	reasons: CommentReason[],
	level: number,
): WebhookPayload["firedRules"] {
	const redacted = redactCommentReasons(reasons, level);
	if (redacted.kind === "reasons") {
		return redacted.reasons.map((reason) => ({
			ruleId: reason.ruleId ?? "",
			summary: reason.text,
		}));
	}
	if (redacted.kind === "names") {
		return reasons.map((reason, index) => ({
			ruleId: reason.ruleId ?? "",
			summary: redacted.names[index] ?? "",
		}));
	}
	return [];
}

export async function emitClosedReviewSurfaces(
	deps: {
		db: Db;
		adapterFor: (
			repoFullName: string,
			forge: Forge,
		) => Promise<ForgeAdapter | null>;
		logger: Logger;
	},
	closed: readonly moderationServices.ClosedReview[],
): Promise<void> {
	for (const review of closed) {
		deps.logger.info(
			{ runId: review.runId, number: review.subjectNumber },
			"change request closed before review, run closed",
		);
		const rows = [review.check, review.comment].flatMap((row) =>
			row ? [row] : [],
		);
		if (rows.length === 0) {
			continue;
		}
		const adapter = await deps.adapterFor(review.repoFullName, review.forge);
		if (!adapter) {
			continue;
		}
		for (const row of rows) {
			try {
				const result = await adapter.execute(
					toForgeAction(
						row,
						review.repoFullName,
						review.subjectNumber,
						REVIEW_POINTER.block,
					),
					{ actionId: row.id },
				);
				if ("refused" in result) {
					deps.logger.warn(
						{ actionId: row.id, reason: result.reason, status: result.status },
						"closed review surface refused, row stays recorded for retry",
					);
					continue;
				}
				await runServices.markActionExecuted(
					deps.db,
					row.id,
					result.externalId,
				);
			} catch (error) {
				deps.logger.warn(
					{
						runId: review.runId,
						kind: row.kind,
						error: getErrorMessage(error),
					},
					"closed review surface failed, the sweep retries it",
				);
			}
		}
	}
}

export function toForgeAction(
	row: { kind: string; payload: Record<string, unknown> },
	repoFullName: string,
	number: number,
	reviewText: string,
	activeReviewId: string | null = null,
) {
	switch (row.kind) {
		case "comment":
			return {
				kind: "comment" as const,
				repoFullName,
				number: (row.payload.number as number) ?? number,
				body: row.payload.body as string,
				verdict: row.payload.verdict as Verdict,
				previousVerdict:
					(row.payload.previousVerdict as Verdict | null | undefined) ?? null,
				onlyIfPresent: row.payload.onlyIfPresent === true,
			};
		case "delete-comment":
			return {
				kind: "delete-comment" as const,
				repoFullName,
				number: (row.payload.number as number) ?? number,
			};
		case "dismiss-review":
			return {
				kind: "dismiss-review" as const,
				repoFullName,
				number: (row.payload.number as number) ?? number,
				reviewId: (row.payload.reviewId as string | null) ?? null,
			};
		case "set-check":
			return {
				kind: "set-check" as const,
				repoFullName,
				check: {
					sha: row.payload.sha as string,
					conclusion: row.payload.conclusion as CheckState["conclusion"],
					summary: row.payload.summary as string,
					detailsUrl: row.payload.detailsUrl as string,
				},
			};
		case "label":
			return {
				kind: "label" as const,
				repoFullName,
				number,
				labels: (row.payload.labels as string[]) ?? [],
			};
		case "lock": {
			const params = lockParamsSchema.safeParse(row.payload);
			const reason = params.success ? params.data.reason : undefined;
			return reason
				? { kind: "lock" as const, repoFullName, number, reason }
				: { kind: "lock" as const, repoFullName, number };
		}
		case "close":
			return { kind: "close" as const, repoFullName, number };
		case "remove-label": {
			const params = labelParamsSchema.safeParse(row.payload);
			return {
				kind: "remove-label" as const,
				repoFullName,
				number,
				labels: params.success ? params.data.labels : [],
			};
		}
		case "post-comment": {
			const params = postCommentParamsSchema.safeParse(row.payload);
			return {
				kind: "post-comment" as const,
				repoFullName,
				number,
				body: params.success ? params.data.message : "",
				marker: String(row.payload.marker ?? ""),
			};
		}
		case "request-review": {
			const targets = requestReviewTargetsSchema.safeParse(row.payload);
			const reviewers: string[] = [];
			const reviewerIds: string[] = [];
			if (targets.success) {
				for (const reviewer of targets.data.reviewers) {
					const gitCafe = gitCafeReviewerRefSchema.safeParse(reviewer);
					if (gitCafe.success) reviewerIds.push(gitCafe.data.id);
					else reviewers.push(reviewer.login);
				}
			}
			const action: Extract<ForgeAction, { kind: "request-review" }> = {
				kind: "request-review",
				repoFullName,
				number,
				reviewers,
				teamReviewers: targets.success ? targets.data.teamReviewers : [],
			};
			if (reviewerIds.length) action.reviewerIds = reviewerIds;
			return action;
		}
		default: {
			const reason = (row.payload.reason as string | undefined) ?? reviewText;
			return activeReviewId
				? {
						kind: "update-review" as const,
						repoFullName,
						number,
						reviewId: activeReviewId,
						reason,
					}
				: { kind: "block" as const, repoFullName, number, reason };
		}
	}
}
