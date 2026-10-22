import type { Db, SyncRepoLabelsJob } from "@tripwire/db";
import { labelServices, repoServices } from "@tripwire/db";
import { type GithubHttp, listRepoLabels } from "@tripwire/forge-github";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";

export interface SyncRepoLabelsDeps {
	db: Db;
	http: GithubHttp | null;
	logger: Logger;
}

export async function syncRepoLabels(
	deps: SyncRepoLabelsDeps,
	job: SyncRepoLabelsJob,
): Promise<void> {
	const { db, http, logger } = deps;
	const repo = await repoServices.getRepoById(db, job.repoId);
	if (!repo || repo.removedAt || repo.forge !== "github") {
		logger.info({ repoId: job.repoId }, "label sync skipped: no github repo");
		return;
	}
	if (!http) {
		logger.warn(
			{ repoId: repo.id },
			"label sync skipped: github reads disabled",
		);
		return;
	}
	try {
		const labels = await listRepoLabels(http, repo.fullName);
		await labelServices.replaceRepoLabels(db, repo.id, labels);
		logger.info(
			{ repo: repo.fullName, labels: labels.length },
			"labels synced",
		);
	} catch (error) {
		logger.warn(
			{ repo: repo.fullName, error: getErrorMessage(error) },
			"label sync failed: kept the last set",
		);
	}
}
