import type { Db, SyncRepoReviewersJob } from "@tripwire/db";
import { repoServices, reviewerServices } from "@tripwire/db";
import { type GithubHttp, listRepoReviewers } from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";

export interface SyncRepoReviewersDeps {
	db: Db;
	http: GithubHttp | null;
	logger: Logger;
}

export async function syncRepoReviewers(
	deps: SyncRepoReviewersDeps,
	job: SyncRepoReviewersJob,
): Promise<void> {
	const { db, http, logger } = deps;
	const repo = await repoServices.getRepoById(db, job.repoId);
	if (!repo || repo.removedAt) {
		logger.info({ repoId: job.repoId }, "reviewer sync skipped: no repo");
		return;
	}
	if (repo.forge !== "github") {
		logger.info({ repoId: repo.id }, "reviewer sync skipped: non-github repo");
		await reviewerServices.stampRepoReviewerSync(db, repo.id);
		return;
	}
	if (!http) {
		logger.warn(
			{ repoId: repo.id },
			"reviewer sync skipped: github reads disabled",
		);
		await reviewerServices.stampRepoReviewerSync(db, repo.id);
		return;
	}
	try {
		const reviewers = await listRepoReviewers(http, repo.fullName);
		await reviewerServices.replaceRepoReviewers(db, repo.id, reviewers);
		logger.info(
			{ repo: repo.fullName, reviewers: reviewers.length },
			"reviewers synced",
		);
	} catch (error) {
		logger.warn(
			{ repo: repo.fullName, error: getErrorMessage(error) },
			"reviewer sync failed: kept the last set",
		);
	}
}
