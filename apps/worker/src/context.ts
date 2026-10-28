import type { RepoScopedEvent } from "@tripwire/contracts";
import type { AiReviewGenerate, RuleContext } from "@tripwire/core";
import type {
	ChangeRequestHead,
	ContributorProfile,
	DiffFile,
	ForgeCommit,
} from "@tripwire/forge";
import type { GitCafeReadResult } from "@tripwire/forge-gitcafe";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
import { forcedReadFailures } from "./reads-injection.ts";

/**
 * §5.8 — ALL reads happen HERE, pre-fetched through the adapter's read
 * surface. Each read degrades independently: a flaky call nulls one context
 * piece, the affected rules skip, the run survives (§4 purity law).
 */

export interface WorkerReads {
	getDiff(
		repoFullName: string,
		number: number,
		head?: ChangeRequestHead,
	): Promise<DiffFile[] | GitCafeReadResult<DiffFile[]>>;
	getCommits(
		repoFullName: string,
		number: number,
		head?: ChangeRequestHead,
	): Promise<ForgeCommit[] | GitCafeReadResult<ForgeCommit[]>>;
	getContributorProfile(
		repoFullName: string,
		login: string,
		expectedActorId?: string,
	): Promise<ContributorProfile | GitCafeReadResult<ContributorProfile>>;
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
	const head = changeRequestHead(event);
	const repo = event.repo.fullName;
	const degradedReads: string[] = [];
	const forcedFailures = forcedReadFailures();

	const guard = async <T extends object>(
		name: string,
		fn: () => Promise<T | GitCafeReadResult<T>>,
	) => {
		try {
			if (forcedFailures.has(name)) {
				throw new Error(
					`TRIPWIRE_FAIL_READS: forced failure of "${name}" read`,
				);
			}
			const result = await fn();
			if (isReadResult(result)) {
				if (result.ok) {
					if (result.diagnostics?.length) degradedReads.push(name);
					for (const diagnostic of result.diagnostics ?? [])
						logger.warn(
							{
								read: name,
								source: diagnostic.source,
								reason: diagnostic.reason,
								status: diagnostic.status,
							},
							"context read partially degraded",
						);
					return result.value;
				}
				degradedReads.push(name);
				logger.warn(
					{ read: name, reason: result.reason },
					"context read degraded",
				);
				return null;
			}
			return result;
		} catch (error) {
			degradedReads.push(name);
			logger.warn(
				{ read: name, error: getErrorMessage(error) },
				"context read degraded",
			);
			return null;
		}
	};

	const [diff, commits, readContributor] = await Promise.all([
		reads && number !== null
			? guard<DiffFile[]>("diff", () => reads.getDiff(repo, number, head))
			: Promise.resolve(null),
		reads && number !== null
			? guard<ForgeCommit[]>("commits", () =>
					reads.getCommits(repo, number, head),
				)
			: Promise.resolve(null),
		reads
			? guard<ContributorProfile>("contributor", () =>
					reads.getContributorProfile(
						repo,
						event.actor.login,
						event.actor.externalId,
					),
				)
			: Promise.resolve(null),
	]);
	const contributor =
		event.forge === "gitcafe" &&
		readContributor?.externalId !== event.actor.externalId
			? null
			: readContributor;
	if (readContributor !== null && contributor === null) {
		degradedReads.push("contributor");
		logger.warn(
			{ read: "contributor", reason: "identity-mismatch" },
			"context read degraded",
		);
	}
	if (diff?.some((file) => file.patchUnavailable != null)) {
		degradedReads.push("diff");
		logger.warn(
			{ read: "diff", reason: "partial-evidence" },
			"context read degraded",
		);
	}

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
				patchUnavailable: file.patchUnavailable,
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

function isReadResult<T extends object>(
	value: T | GitCafeReadResult<T>,
): value is GitCafeReadResult<T> {
	return "ok" in value;
}

export function changeRequestHead(
	event: RepoScopedEvent,
): ChangeRequestHead | undefined {
	if (!("changeRequest" in event) || !event.changeRequest.baseRef) {
		return undefined;
	}
	return {
		sha: event.changeRequest.headSha,
		baseRef: event.changeRequest.baseRef,
	};
}
