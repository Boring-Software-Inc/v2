import type { RepoScopedEvent } from "@tripwire/contracts";
import type { AiReviewGenerate, RuleContext } from "@tripwire/core";
import type {
	ContributorProfile,
	DiffFile,
	ForgeCommit,
} from "@tripwire/forge";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";

/**
 * §5.8 — ALL reads happen HERE, pre-fetched through the adapter's read
 * surface. Each read degrades independently: a flaky call nulls one context
 * piece, the affected rules skip, the run survives (§4 purity law).
 */

export interface WorkerReads {
	getDiff(repoFullName: string, number: number): Promise<DiffFile[]>;
	getCommits(repoFullName: string, number: number): Promise<ForgeCommit[]>;
	getContributorProfile(
		repoFullName: string,
		login: string,
	): Promise<ContributorProfile>;
}

export interface BuiltRuleContext {
	ctx: RuleContext;
	/** Reads that failed — the run-level degradation evidence (fail-closed floor). */
	degradedReads: string[];
}

export async function buildRuleContext(
	event: RepoScopedEvent,
	reads: WorkerReads | null,
	now: string,
	logger: Logger,
	generate?: AiReviewGenerate,
): Promise<BuiltRuleContext> {
	const number = "changeRequest" in event ? event.changeRequest.number : null;
	const repo = event.repo.fullName;
	const degradedReads: string[] = [];

	const guard = async <T>(name: string, fn: () => Promise<T>) => {
		try {
			return await fn();
		} catch (error) {
			degradedReads.push(name);
			logger.warn(
				{ read: name, error: getErrorMessage(error) },
				"context read degraded",
			);
			return null;
		}
	};

	const [diff, commits, contributor] = await Promise.all([
		reads && number !== null
			? guard("diff", () => reads.getDiff(repo, number))
			: Promise.resolve(null),
		reads && number !== null
			? guard("commits", () => reads.getCommits(repo, number))
			: Promise.resolve(null),
		reads
			? guard("contributor", () =>
					reads.getContributorProfile(repo, event.actor.login),
				)
			: Promise.resolve(null),
	]);

	const ctx: RuleContext = {
		event,
		now,
		generate,
		diff:
			diff?.map((file) => ({
				path: file.path,
				status: file.status,
				additions: file.additions,
				deletions: file.deletions,
				patch: file.patch,
			})) ?? null,
		commits:
			commits?.map((commit) => ({
				sha: commit.sha,
				message: commit.message,
				authorLogin: commit.authorLogin,
				authoredAt: commit.authoredAt,
			})) ?? null,
		contributor: contributor
			? {
					login: contributor.login,
					createdAt: contributor.createdAt,
					followers: contributor.followers,
					publicRepos: contributor.publicRepos,
					profileText: contributor.profileText,
					mergedInRepo: contributor.mergedInRepo,
					mergedElsewhere: contributor.mergedElsewhere,
					recentChangeRequestTimes: contributor.recentChangeRequestTimes,
					isOrgMember: contributor.isOrgMember,
					isMaintainer: contributor.isMaintainer,
				}
			: null,
	};
	return { ctx, degradedReads };
}
