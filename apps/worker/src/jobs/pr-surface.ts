import type { CheckState, NormalizedEvent, Verdict } from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { runServices } from "@tripwire/db";
import type { ForgeAdapter } from "@tripwire/forge";
import {
	type CommentReason,
	checkSummary,
	PENDING_CHECK_SUMMARY,
	renderCommentBody,
	reviewBody,
} from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";

/**
 * §5.13 + §7: the two PR artifacts — ONE upserted comment (the face) and ONE
 * `tripwire` check per head SHA (the gate) — emitted from the same
 * persistence step so they can never disagree. Both are recorded as action
 * rows FIRST (§5.12) and marked executed after.
 */

const VERDICT_TO_CONCLUSION: Record<Verdict, CheckState["conclusion"]> = {
	pass: "success",
	block: "failure",
	needs_review: "neutral",
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
): Promise<void> {
	if (!deps.adapter || !("changeRequest" in event)) {
		return;
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
	} catch (error) {
		deps.logger.warn(
			{ error: getErrorMessage(error) },
			"pending check emission failed",
		);
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
	if (!("changeRequest" in event)) {
		return;
	}
	const repoFullName = event.repo.fullName;
	const number = event.changeRequest.number;
	const sha = event.changeRequest.headSha;
	const runUrl = `${deps.appUrl}/runs/${runId}`;
	const badgeUrl = `${deps.appUrl}/badges/view-run.png`;
	const { reasons } = input;
	const review = reviewBody(reasons);

	const surfaceRows = await runServices.recordActions(db, runId, [
		{
			kind: "comment",
			payload: {
				number,
				body: renderCommentBody({
					verdict,
					contributorLogin: event.actor.login,
					reasons,
					runUrl,
					badgeUrl,
					degraded: input.degraded,
				}),
			},
			idempotencyKey: `comment:${number}:${verdict}`,
		},
		{
			kind: "set-check",
			payload: {
				sha,
				conclusion: VERDICT_TO_CONCLUSION[verdict],
				summary: checkSummary(verdict, reasons, input.degraded),
				detailsUrl: runUrl,
			},
			idempotencyKey: `check:${sha}:${verdict}`,
		},
	]);

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

	for (const row of [...input.pendingActionRows, ...surfaceRows]) {
		if (row.kind === "comment" && latestRunId && latestRunId !== runId) {
			await runServices.markActionSuperseded(db, row.id);
			logger.info(
				{ runId, latestRunId, number },
				"comment superseded — not the latest run for this change request",
			);
			continue;
		}
		const forgeAction = toForgeAction(row, repoFullName, number, review);
		try {
			const result = await adapter.execute(forgeAction);
			await runServices.markActionExecuted(db, row.id, result.externalId);
		} catch (error) {
			if (row.kind === "block") {
				logger.warn(
					{ actionId: row.id, error: getErrorMessage(error) },
					"request-changes review failed (legal on own PRs / missing permission) — check remains the gate",
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

export function toForgeAction(
	row: { kind: string; payload: Record<string, unknown> },
	repoFullName: string,
	number: number,
	reviewText: string,
) {
	switch (row.kind) {
		case "comment":
			return {
				kind: "comment" as const,
				repoFullName,
				number: (row.payload.number as number) ?? number,
				body: row.payload.body as string,
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
		case "request-review":
			return { kind: "request-review" as const, repoFullName, number };
		default:
			return {
				kind: "block" as const,
				repoFullName,
				number,
				// A workflow-authored block may carry its own message; else the
				// computed review stamp.
				reason: (row.payload.reason as string | undefined) ?? reviewText,
			};
	}
}
