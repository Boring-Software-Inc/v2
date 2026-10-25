import { type Db, repoServices, type SyncRepoBranchesJob } from "@tripwire/db";
import { type GithubHttp, githubForge } from "@tripwire/forge-github";
import type { Logger } from "pino";

/**
 * Refreshes the cached branch suggestions for a repo. The worker holds the
 * installation token and runs on push/install, so the web never calls GitHub;
 * it reads the cached row. Best effort: a failed fetch leaves the old cache (or
 * none), and the builder falls back to free text. Keeps suggestions fresh on
 * fast-moving repos, where a TTL alone would lag.
 */
export async function refreshBranchSuggestions(
	db: Db,
	http: GithubHttp | null | undefined,
	repoId: string,
	repoFullName: string,
): Promise<void> {
	const suggester = githubForge.suggest?.branches;
	if (!http || !suggester) {
		return;
	}
	try {
		const branches = await suggester({ forge: http, repo: repoFullName });
		await repoServices.upsertRepoSuggestions(db, repoId, "branches", branches);
	} catch {
		// Stale or missing suggestions are acceptable; never fail the job.
	}
}

export interface SyncRepoBranchesDeps {
	db: Db;
	http: GithubHttp | null;
	logger: Logger;
}

export async function syncRepoBranches(
	deps: SyncRepoBranchesDeps,
	job: SyncRepoBranchesJob,
): Promise<void> {
	const { db, http, logger } = deps;
	const repo = await repoServices.getRepoById(db, job.repoId);
	if (!repo || repo.removedAt || repo.forge !== "github") {
		logger.info({ repoId: job.repoId }, "branch sync skipped: no github repo");
		return;
	}
	await refreshBranchSuggestions(db, http, repo.id, repo.fullName);
}
