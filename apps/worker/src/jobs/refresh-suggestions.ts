import type { GitCafeRefreshCatalogsJob } from "@tripwire/contracts";
import {
	type Db,
	labelServices,
	repoServices,
	type SyncRepoBranchesJob,
} from "@tripwire/db";
import { type GithubHttp, githubForge } from "@tripwire/forge-github";
import type { Logger } from "pino";
import type { GitCafeRuntime } from "../gitcafe-runtime.ts";

/** Only complete catalog reads replace caches; one unavailable source preserves its previous values. */
export async function refreshGitCafeCatalogs(
	deps: {
		db: Db;
		runtime: Pick<GitCafeRuntime, "getBranches" | "getLabels">;
		logger: Logger;
	},
	job: GitCafeRefreshCatalogsJob,
): Promise<{ ok: boolean }> {
	const repo = await repoServices.getRepoById(deps.db, job.repoId);
	if (!repo || repo.removedAt || repo.forge !== "gitcafe") return { ok: true };
	const branches = await deps.runtime.getBranches(repo.fullName);
	const labels = await deps.runtime.getLabels(repo.fullName);
	if (branches.ok)
		await repoServices.upsertRepoSuggestions(
			deps.db,
			repo.id,
			"branches",
			branches.value,
		);
	else
		deps.logger.warn(
			{
				requestId: job.requestId,
				repoId: repo.id,
				source: "branches",
				reason: branches.reason,
				status: branches.status,
			},
			"GitCafe catalog unavailable; kept previous values",
		);
	if (labels.ok)
		await labelServices.replaceRepoLabels(deps.db, repo.id, labels.value);
	else
		deps.logger.warn(
			{
				requestId: job.requestId,
				repoId: repo.id,
				source: "labels",
				reason: labels.reason,
				status: labels.status,
			},
			"GitCafe catalog unavailable; kept previous values",
		);
	return { ok: branches.ok && labels.ok };
}

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
