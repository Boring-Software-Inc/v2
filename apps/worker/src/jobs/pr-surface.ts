import {
	type CheckState,
	type CommentReason,
	checkSummary,
	forgePostsReviews,
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
	type WebhookPayload,
	wantsCheck,
} from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { repoServices, responseServices, runServices } from "@tripwire/db";
import type { ForgeAdapter } from "@tripwire/forge";
import { PENDING_CHECK_SUMMARY } from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";

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
		needs_review: "pending",
	};

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
): Promise<boolean> {
	if (!deps.adapter || !("changeRequest" in event)) {
		return false;
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
		await deps.adapter.execute({
			kind: "set-check",
			repoFullName: event.repo.fullName,
			check: {
				sha: event.changeRequest.headSha,
				conclusion: "pending",
				summary: PENDING_CHECK_SUMMARY,
				detailsUrl: deps.appUrl,
			},
		});
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
	pendingCheckPosted?: boolean;
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
	const { reasons } = input;

	// The verdict the PR already shows — drives the resolution copy AND whether a
	// stale request-changes review must be dismissed (§7).
	const previousVerdict = await runServices.getPreviousVerdict(
		db,
		repoFullName,
		number,
		runId,
	);
	// A block that just cleared ⇒ dismiss its outstanding request-changes review
	// (it can't self-edit and would keep gating merge on required-review repos).
	const reviewToDismiss =
		verdict !== "block" && previousVerdict === "block"
			? await runServices.getLatestBlockReviewId(db, repoFullName, number)
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
	const blockRows = input.pendingActionRows.filter(
		(row) => row.kind === "block",
	);
	const plan = planSurfaces(
		{
			verdict,
			contributorLogin: event.actor.login,
			reasons,
			runUrl,
			degraded: input.degraded,
			previousVerdict,
			rerun: input.rerun,
		},
		responseConfig,
		policy,
		{ reviewPosted: blockRows.length > 0 && forgePostsReviews(event.forge) },
	);
	const review = plan.review ?? REVIEW_POINTER.block;
	for (const row of blockRows) {
		row.payload = { ...row.payload, reason: review };
		await runServices.stampReviewBody(db, row.id, review);
	}
	let activeReviewId =
		blockRows.length > 0
			? await runServices.getActiveBlockReviewId(db, repoFullName, number)
			: null;
	const includeCheck =
		wantsCheck(responseConfig, verdict) || input.pendingCheckPosted === true;

	const surfaceRows = await runServices.recordActions(db, runId, [
		...commentRows(plan, number, verdict, previousVerdict),
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
							),
							detailsUrl: runUrl,
						},
						idempotencyKey: `check:${sha}:${verdict}`,
					},
				]
			: []),
		...(reviewToDismiss
			? [
					{
						kind: "dismiss-review",
						payload: { number, reviewId: reviewToDismiss },
						idempotencyKey: `dismiss-review:${reviewToDismiss}`,
					},
				]
			: []),
	]);

	// Outbound delivery (webhook) is independent of GitHub — build and
	// attach each row's payload here (we have the run context + appUrl), leave
	// it `recorded`, and let the deliver-webhook job POST it through the guard.
	// This runs BEFORE the forge guard so webhooks fire even with no GitHub
	// credentials.
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

	/**
	 * Comment ownership (§6 — live finding): the comment is per-PR but runs are
	 * per-SHA. Only the LATEST run for the change request may execute its
	 * comment — otherwise an out-of-order decision on an older run upserts a
	 * stale comment over the current one. Non-latest runs still emit their
	 * per-SHA check (correct and harmless); their comment is superseded.
	 */
	const latestRunId = await runServices.getLatestRunIdForChangeRequest(
		db,
		repoFullName,
		number,
	);
	const latestRun =
		latestRunId && latestRunId !== runId
			? await runServices.getRunById(db, latestRunId)
			: null;
	const checkOwnedByNewerRun = latestRun?.headSha === sha;

	for (const row of [...input.pendingActionRows, ...surfaceRows]) {
		// Outbound delivery is handled above + by the deliver-webhook job, not
		// through the forge adapter.
		if (row.kind === "webhook") {
			continue;
		}
		// Ownership (§6): only the latest run writes to the shared PR — the comment
		// AND the review dismissal. A stale run must not post a transition or
		// dismiss the current run's review.
		if (
			PER_CHANGE_REQUEST_KINDS.has(row.kind) &&
			latestRunId &&
			latestRunId !== runId
		) {
			await runServices.markActionSuperseded(db, row.id);
			logger.info(
				{ runId, latestRunId, number, kind: row.kind },
				"action superseded — not the latest run for this change request",
			);
			continue;
		}
		if (row.kind === "set-check" && checkOwnedByNewerRun) {
			await runServices.markActionSuperseded(db, row.id);
			logger.info(
				{ runId, latestRunId, sha },
				"check superseded, a newer run owns this head",
			);
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
			const result = await adapter.execute(forgeAction);
			await runServices.markActionExecuted(db, row.id, result.externalId);
			if (row.kind === "block" && result.externalId) {
				activeReviewId = result.externalId;
			}
		} catch (error) {
			// Best-effort actions: the check is the real gate, and a review dismiss
			// or review request is a nicety — a failure warns and settles the row.
			if (
				row.kind === "block" ||
				row.kind === "dismiss-review" ||
				row.kind === "request-review"
			) {
				logger.warn(
					{ actionId: row.id, kind: row.kind, error: getErrorMessage(error) },
					"best-effort forge action failed — check remains the gate",
				);
				await runServices.markActionExecuted(db, row.id, null);
				continue;
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
			);
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

const PER_CHANGE_REQUEST_KINDS = new Set([
	"comment",
	"delete-comment",
	"dismiss-review",
]);

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
				reviewId: row.payload.reviewId as string,
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
			return {
				kind: "request-review" as const,
				repoFullName,
				number,
				reviewers: targets.success
					? targets.data.reviewers.map((reviewer) => reviewer.login)
					: [],
				teamReviewers: targets.success ? targets.data.teamReviewers : [],
			};
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
