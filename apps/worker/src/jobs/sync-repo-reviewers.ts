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
	if (!repo || repo.removedAt || repo.forge !== "github") {
		logger.info(
			{ repoId: job.repoId },
			"reviewer sync skipped: no github repo",
		);
		return;
	}
	if (!http) {
		logger.warn(
			{ repoId: repo.id },
			"reviewer sync skipped: github reads disabled",
		);
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
