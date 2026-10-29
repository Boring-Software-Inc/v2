import {
	checkSummary,
	forgePostsReviews,
	normalizedEventSchema,
	planSurfaces,
	REVIEW_POINTER,
	redactionLevelFor,
	wantsCheck,
} from "@tripwire/contracts";
import type { RefreshSurfacesJob } from "@tripwire/db";
import {
	eventServices,
	repoServices,
	responseServices,
	runServices,
} from "@tripwire/db";
import { getErrorMessage } from "@tripwire/utils";
import { buildCommentReasons } from "./comment-reasons.ts";
import { customRuleSource } from "./custom-rules.ts";
import {
	commentRows,
	recoverGitCafeRunSurface,
	toForgeAction,
	VERDICT_TO_CONCLUSION,
} from "./pr-surface.ts";
import type { ProcessEventDeps } from "./process-event.ts";
import { loadRunIssues } from "./run-issues.ts";

const REFRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type RefreshSurfacesDeps = Pick<
	ProcessEventDeps,
	"db" | "logger" | "resolveForge" | "appUrl"
>;

export async function refreshRepoSurfaces(
	deps: RefreshSurfacesDeps,
	job: RefreshSurfacesJob,
	jobId: string,
): Promise<void> {
	const { db, logger } = deps;
	const repo = await repoServices.getRepoById(db, job.repoId);
	if (!repo) {
		return;
	}
	const adapter = deps.resolveForge(repo.forge)?.adapter ?? null;
	if (!adapter) {
		logger.warn({ repoId: repo.id }, "no forge runtime, refresh skipped");
		return;
	}
	if (repo.forge === "gitcafe") {
		const open = await runServices.listOpenBlockedRuns(
			db,
			repo,
			new Date(Date.now() - REFRESH_WINDOW_MS),
		);
		for (const target of open) {
			const run = await runServices.getRunById(db, target.runId);
			const event = run
				? await eventServices.getEventById(db, run.eventId)
				: null;
			const normalized = normalizedEventSchema.safeParse(event?.normalized);
			if (!normalized.success) continue;
			if (
				!(await recoverGitCafeRunSurface(
					{ db, adapter, logger, appUrl: deps.appUrl },
					target.runId,
					normalized.data,
					{ refreshId: jobId },
				))
			)
				throw new Error(
					"Committed GitCafe refresh cannot recover its surfaces",
				);
		}
		return;
	}
	const [config, policy, customRows, open] = await Promise.all([
		repoServices.getResponseConfig(db, repo.id),
		responseServices.getRedactionPolicy(db, repo.id),
		repoServices.listCustomRules(db, repo.id),
		runServices.listOpenBlockedRuns(
			db,
			repo,
			new Date(Date.now() - REFRESH_WINDOW_MS),
		),
	]);
	const customRecords = customRuleSource(customRows, null).records;
	const reviews = forgePostsReviews(repo.forge);

	for (const target of open) {
		const runData = await runServices.getRunWithSteps(db, target.runId);
		const eventRow = await eventServices.getLatestChangeRequestEvent(
			db,
			repo,
			target.subjectNumber,
		);
		const event = normalizedEventSchema.safeParse(eventRow?.normalized);
		if (!runData || !event.success || !("changeRequest" in event.data)) {
			continue;
		}
		const { reasons, issues } = await loadRunIssues(
			db,
			target.runId,
			buildCommentReasons(runData.steps, customRecords),
		);
		const verdict = target.verdict;
		const runUrl = `${deps.appUrl}/runs/${target.runId}`;
		const sha = target.headSha ?? event.data.changeRequest.headSha;
		const activeReviewId =
			reviews && verdict === "block"
				? await runServices.getActiveBlockReviewId(
						db,
						repo,
						target.subjectNumber,
					)
				: null;
		const plan = planSurfaces(
			{
				verdict,
				contributorLogin: event.data.actor.login,
				reasons,
				runUrl,
				previousVerdict: verdict,
				title: event.data.changeRequest.title,
				targetBranch: event.data.changeRequest.baseRef ?? null,
				...issues,
			},
			config,
			policy,
			{ reviewPosted: activeReviewId !== null },
		);
		const review = plan.review ?? REVIEW_POINTER.block;
		const rows = await runServices.recordActions(db, target.runId, [
			...commentRows(plan, target.subjectNumber, verdict, verdict).map(
				(row) => ({
					...row,
					idempotencyKey: `refresh:${jobId}:${row.idempotencyKey}`,
				}),
			),
			...(activeReviewId
				? [
						{
							kind: "block",
							payload: { reason: review },
							idempotencyKey: `refresh:${jobId}:review:${target.subjectNumber}`,
						},
					]
				: []),
			...(wantsCheck(config, verdict)
				? [
						{
							kind: "set-check",
							payload: {
								sha,
								conclusion: VERDICT_TO_CONCLUSION[verdict],
								summary: checkSummary(
									verdict,
									reasons,
									false,
									redactionLevelFor(policy, "check"),
									false,
									issues,
								),
								detailsUrl: runUrl,
							},
							idempotencyKey: `refresh:${jobId}:check:${sha}`,
						},
					]
				: []),
		]);
		for (const row of rows) {
			try {
				const result = await adapter.execute(
					toForgeAction(
						row,
						repo.fullName,
						target.subjectNumber,
						review,
						activeReviewId,
					),
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
						"refresh action refused, row stays recorded for retry",
					);
					continue;
				}
				await runServices.markActionExecuted(db, row.id, result.externalId);
			} catch (error) {
				logger.error(
					{ actionId: row.id, kind: row.kind, error: getErrorMessage(error) },
					"refresh action failed, row stays recorded for retry",
				);
			}
		}
	}
}
