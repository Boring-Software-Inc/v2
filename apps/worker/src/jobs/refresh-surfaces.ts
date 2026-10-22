import {
	checkSummary,
	normalizedEventSchema,
	redactionLevelFor,
	renderVerdictComment,
	reviewBody,
	wantsCheck,
	wantsComment,
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
import { toForgeAction, VERDICT_TO_CONCLUSION } from "./pr-surface.ts";
import type { ProcessEventDeps } from "./process-event.ts";

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
	const [config, policy, customRows, open] = await Promise.all([
		repoServices.getResponseConfig(db, repo.id),
		responseServices.getRedactionPolicy(db, repo.id),
		repoServices.listCustomRules(db, repo.id),
		runServices.listOpenBlockedRuns(
			db,
			repo.fullName,
			new Date(Date.now() - REFRESH_WINDOW_MS),
		),
	]);
	const customRecords = customRuleSource(customRows, null).records;
	const review = reviewBody(wantsComment(config, "block"));

	for (const target of open) {
		const runData = await runServices.getRunWithSteps(db, target.runId);
		const eventRow = await eventServices.getLatestChangeRequestEvent(
			db,
			repo.fullName,
			target.subjectNumber,
		);
		const event = normalizedEventSchema.safeParse(eventRow?.normalized);
		if (!runData || !event.success || !("changeRequest" in event.data)) {
			continue;
		}
		const reasons = buildCommentReasons(runData.steps, customRecords);
		const runUrl = `${deps.appUrl}/runs/${target.runId}`;
		const sha = target.headSha ?? event.data.changeRequest.headSha;
		const rows = await runServices.recordActions(db, target.runId, [
			...(wantsComment(config, "block")
				? [
						{
							kind: "comment",
							payload: {
								number: target.subjectNumber,
								verdict: "block",
								previousVerdict: "block",
								body: renderVerdictComment(
									{
										verdict: "block",
										contributorLogin: event.data.actor.login,
										reasons,
										runUrl,
									},
									config,
									policy,
								),
							},
							idempotencyKey: `refresh:${jobId}:comment:${target.subjectNumber}`,
						},
					]
				: []),
			...(wantsCheck(config, "block")
				? [
						{
							kind: "set-check",
							payload: {
								sha,
								conclusion: VERDICT_TO_CONCLUSION.block,
								summary: checkSummary(
									"block",
									reasons,
									false,
									redactionLevelFor(policy, "check"),
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
					toForgeAction(row, repo.fullName, target.subjectNumber, review),
				);
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
