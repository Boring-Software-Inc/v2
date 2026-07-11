import type { CheckState, NormalizedEvent, Verdict } from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { runServices } from "@tripwire/db";
import type { ForgeAdapter } from "@tripwire/forge";
import { renderCommentBody } from "@tripwire/forge-github";
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

export function verdictSentence(
	verdict: Verdict,
	stats: { evaluated: number; failed: number },
	degraded = false,
): string {
	if (verdict === "block") {
		const rules = stats.failed === 1 ? "rule" : "rules";
		return `this change tripped ${stats.failed} of ${stats.evaluated} ${rules}. it can't merge until they clear.`;
	}
	if (verdict === "needs_review") {
		return degraded
			? "couldn't finish checking this change, so a maintainer will make the call."
			: "this change needs a maintainer's eyes before it can merge.";
	}
	return `cleared all ${stats.evaluated} rules — good to merge.`;
}

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
				summary: "tripwire is evaluating this change request.",
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
	stats: { evaluated: number; failed: number };
	/** Fail-closed floor fired — the sentence names the degradation. */
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
	const sentence = verdictSentence(verdict, input.stats, input.degraded);

	const surfaceRows = await runServices.recordActions(db, runId, [
		{
			kind: "comment",
			payload: {
				number,
				body: renderCommentBody({ verdict, sentence, runUrl, badgeUrl }),
			},
			idempotencyKey: `comment:${number}:${verdict}`,
		},
		{
			kind: "set-check",
			payload: {
				sha,
				conclusion: VERDICT_TO_CONCLUSION[verdict],
				summary: `tripwire: ${verdict === "needs_review" ? "sent to review" : verdict === "block" ? "blocked" : "passed"} — ${sentence}`,
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

	for (const row of [...input.pendingActionRows, ...surfaceRows]) {
		const forgeAction = toForgeAction(row, repoFullName, number, {
			runUrl,
			sentence,
		});
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

function toForgeAction(
	row: { kind: string; payload: Record<string, unknown> },
	repoFullName: string,
	number: number,
	context: { runUrl: string; sentence: string },
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
				reason: `blocked by tripwire. the full breakdown is in the tripwire comment on this PR — ${context.runUrl}`,
			};
	}
}
