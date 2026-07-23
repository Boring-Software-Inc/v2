import type { RepoScopedEvent } from "@tripwire/contracts";
import {
	accountAge,
	addedCommentCount,
	allCommitsByAuthor,
	allCommitsConventional,
	allCommitsVerified,
	body,
	changedPaths,
	closedUnmergedInRepo,
	codeReferenceCount,
	commentBody,
	commentedInRepo,
	commitAuthors,
	commitCount,
	commitMessages,
	company,
	conventionalCommits,
	countAddedComments,
	countCodeReferences,
	countEmoji,
	defineForge,
	distinctExtensions,
	emojiCount,
	extractIssueNumbers,
	type ForgeSignalCtx,
	fileExtensions,
	filesChanged,
	followers,
	following,
	hireable,
	isConventionalSubject,
	isDraft,
	isMaintainer,
	isOrgMember,
	isPublicProfile,
	issuesOpenedInRepo,
	linesAdded,
	linesChanged,
	linesDeleted,
	linkedIssueCount,
	location,
	login,
	maintainerCanModify,
	maxCommitMessageLength,
	mergedElsewhere,
	mergedInRepo,
	mergeRatioGlobal,
	mergeRatioInRepo,
	negativeReactions,
	patchByPath,
	profileCompleteness,
	profileText,
	prsOpened,
	publicGists,
	publicRepos,
	recentChangeRequestTimes,
	recentForkTimes,
	referencedIssueNumbers,
	signalUnavailable,
	sourceBranch,
	targetBranch,
	textByLocation,
	title,
	titleIsConventional,
	verifiedCommits,
} from "@tripwire/sdk";
import type { GithubHttp } from "./client/http.ts";

/**
 * The GitHub forge for the signal registry: the first defineForge consumer,
 * no special path. Every producer calls ctx.forge, the pre-authed GithubHttp
 * client the backend injects at eval time. Fetch URLs mirror
 * client/reads.ts verbatim; shared loader keys keep the per-run API volume
 * at or below today's pre-fetch (one user fetch feeds five contributor
 * signals, one files fetch feeds three pr signals).
 */

const DAY_MS = 86_400_000;

type Ctx = ForgeSignalCtx<GithubHttp>;

function repoOf(event: RepoScopedEvent): string {
	return event.repo.fullName;
}

function changeRequestNumber(event: RepoScopedEvent): number {
	if ("changeRequest" in event) {
		return event.changeRequest.number;
	}
	signalUnavailable("this event has no change request");
}

interface GithubUser {
	id: number;
	created_at: string;
	followers: number;
	following: number;
	public_repos: number;
	public_gists: number;
	hireable: boolean | null;
	company: string | null;
	location: string | null;
	bio: string | null;
	name: string | null;
	blog: string | null;
	email: string | null;
	twitter_username: string | null;
	user_view_type?: string;
}

/**
 * The ten profile fields scores for completeness. hireable counts
 * when set to anything but null; followers and following count when above zero.
 */
function profileFieldsPresent(user: GithubUser): number {
	const present = [
		!!user.name,
		!!user.company,
		!!user.blog,
		!!user.location,
		!!user.email,
		user.hireable !== null,
		!!user.bio,
		!!user.twitter_username,
		user.followers > 0,
		user.following > 0,
	];
	return present.filter(Boolean).length;
}

function loadUser(ctx: Ctx): Promise<GithubUser> {
	return ctx.load(
		"user",
		() =>
			ctx.forge.get(
				repoOf(ctx.event),
				`/users/${ctx.event.actor.login}`,
			) as Promise<GithubUser>,
	);
}

/** Profile README, readFile semantics from reads.ts: any failure is null. */
function loadProfileReadme(ctx: Ctx): Promise<string | null> {
	return ctx.load("profile-readme", async () => {
		const login = ctx.event.actor.login;
		try {
			const data = (await ctx.forge.get(
				repoOf(ctx.event),
				`/repos/${login}/${login}/contents/README.md?ref=HEAD`,
			)) as { content?: string; encoding?: string };
			if (data.content && data.encoding === "base64") {
				return Buffer.from(data.content, "base64").toString("utf8");
			}
			return null;
		} catch {
			return null;
		}
	});
}

function searchIssues(ctx: Ctx, query: string, perPage: number) {
	return ctx.forge.get(
		repoOf(ctx.event),
		`/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}`,
	);
}

/**
 * A memoized issue-search total, null when the read fails. The key is what
 * dedupes: passing the same key as another producer's load means both share the
 * one fetch, which is how the two merge-ratio signals cost zero extra calls.
 */
async function loadSearchCount(
	ctx: Ctx,
	key: string,
	query: string,
): Promise<number | null> {
	const result = (await ctx
		.load(key, () => searchIssues(ctx, query, 1))
		.catch(() => null)) as { total_count: number } | null;
	return result?.total_count ?? null;
}

function mergeRatioPercent(merged: number, decided: number): number {
	return Math.round((merged / decided) * 100);
}

interface PrFile {
	filename: string;
	status?: string;
	additions: number;
	deletions: number;
	patch?: string;
}

function loadPrFiles(ctx: Ctx): Promise<PrFile[]> {
	const number = changeRequestNumber(ctx.event);
	return ctx
		.load(
			"pr-files",
			() =>
				ctx.forge.get(
					repoOf(ctx.event),
					`/repos/${repoOf(ctx.event)}/pulls/${number}/files?per_page=100`,
				) as Promise<PrFile[]>,
		)
		.catch(() =>
			signalUnavailable("this change request's files are unavailable"),
		);
}

interface PrCommit {
	commit: { message?: string; verification?: { verified: boolean } };
	author: { login: string } | null;
}

function loadPrCommits(ctx: Ctx): Promise<PrCommit[]> {
	const number = changeRequestNumber(ctx.event);
	return ctx
		.load(
			"pr-commits",
			() =>
				ctx.forge.get(
					repoOf(ctx.event),
					`/repos/${repoOf(ctx.event)}/pulls/${number}/commits?per_page=100`,
				) as Promise<PrCommit[]>,
		)
		.catch(() =>
			signalUnavailable("this change request's commits are unavailable"),
		);
}

interface PrDetails {
	body: string | null;
	maintainer_can_modify: boolean;
}

/** The change request object itself, the one call that carries body and flags. */
function loadPrDetails(ctx: Ctx): Promise<PrDetails> {
	const number = changeRequestNumber(ctx.event);
	return ctx
		.load(
			"pr-details",
			() =>
				ctx.forge.get(
					repoOf(ctx.event),
					`/repos/${repoOf(ctx.event)}/pulls/${number}`,
				) as Promise<PrDetails>,
		)
		.catch(() =>
			signalUnavailable("this change request's details are unavailable"),
		);
}

interface IssueReactions {
	reactions?: { "-1"?: number; confused?: number };
}

/** The issue view of the change request, for its reaction counts. */
function loadIssueReactions(ctx: Ctx): Promise<IssueReactions> {
	const number = changeRequestNumber(ctx.event);
	return ctx
		.load(
			"issue-reactions",
			() =>
				ctx.forge.get(
					repoOf(ctx.event),
					`/repos/${repoOf(ctx.event)}/issues/${number}`,
				) as Promise<IssueReactions>,
		)
		.catch(() =>
			signalUnavailable("this change request's reactions are unavailable"),
		);
}

function changeRequestOf(event: RepoScopedEvent) {
	if ("changeRequest" in event) {
		return event.changeRequest;
	}
	signalUnavailable("this event has no change request");
}

async function prBody(ctx: Ctx): Promise<string> {
	return (await loadPrDetails(ctx)).body ?? "";
}

interface UserEvent {
	type: string;
	created_at: string;
}

const EVENTS_HISTORY_MS = 7 * DAY_MS;

/**
 * The per-user public events feed, paginated up to GitHub's cap (300 events,
 * 3 pages) but stopping early once the oldest fetched event predates the
 * 7 day history every events-backed signal declares.
 */
function loadUserEvents(ctx: Ctx): Promise<UserEvent[]> {
	return ctx.load("user-events", async () => {
		const cutoff = Date.parse(ctx.now) - EVENTS_HISTORY_MS;
		const events: UserEvent[] = [];
		for (let page = 1; page <= 3; page++) {
			const batch = (await ctx.forge.get(
				repoOf(ctx.event),
				`/users/${ctx.event.actor.login}/events?per_page=100&page=${page}`,
			)) as UserEvent[];
			events.push(...batch);
			const oldest = batch[batch.length - 1];
			if (batch.length < 100 || !oldest) {
				break;
			}
			if (Date.parse(oldest.created_at) < cutoff) {
				break;
			}
		}
		return events;
	});
}

function loadPermission(ctx: Ctx): Promise<string> {
	return ctx.load("permission", async () => {
		const repo = repoOf(ctx.event);
		try {
			const data = (await ctx.forge.get(
				repo,
				`/repos/${repo}/collaborators/${ctx.event.actor.login}/permission`,
			)) as { permission: string };
			return data.permission;
		} catch {
			// Matches reads.ts: a failed permission read means "none", not a skip.
			return "none";
		}
	});
}

function hasWriteAccess(permission: string): boolean {
	return (
		permission === "admin" ||
		permission === "maintain" ||
		permission === "write"
	);
}

export const githubForge = defineForge<GithubHttp>()({
	id: "github",
	produces: {
		[accountAge.id]: async (ctx) => {
			const user = await loadUser(ctx);
			const created = Date.parse(user.created_at);
			if (Number.isNaN(created)) {
				signalUnavailable("contributor createdAt unparseable");
			}
			return Math.floor((Date.parse(ctx.now) - created) / DAY_MS);
		},
		[followers.id]: async (ctx) => (await loadUser(ctx)).followers,
		[following.id]: async (ctx) => (await loadUser(ctx)).following,
		[publicRepos.id]: async (ctx) => (await loadUser(ctx)).public_repos,
		[publicGists.id]: async (ctx) => (await loadUser(ctx)).public_gists,
		[hireable.id]: async (ctx) => (await loadUser(ctx)).hireable === true,
		[company.id]: async (ctx) => (await loadUser(ctx)).company ?? "",
		[location.id]: async (ctx) => (await loadUser(ctx)).location ?? "",
		[prsOpened.id]: async (ctx) => {
			const login = ctx.event.actor.login;
			const result = (await ctx
				.load("prs-opened", () => searchIssues(ctx, `author:${login} is:pr`, 1))
				.catch(() => null)) as { total_count: number } | null;
			if (result === null) {
				signalUnavailable("change request history unavailable");
			}
			return result.total_count;
		},
		[recentForkTimes.id]: async (ctx) => {
			const events = await loadUserEvents(ctx).catch(() =>
				signalUnavailable("fork history unavailable"),
			);
			const cutoff = Date.parse(ctx.now) - EVENTS_HISTORY_MS;
			return events
				.filter(
					(event) =>
						event.type === "ForkEvent" &&
						Date.parse(event.created_at) >= cutoff,
				)
				.map((event) => event.created_at);
		},
		[profileText.id]: async (ctx) => {
			const [readme, user] = await Promise.all([
				loadProfileReadme(ctx),
				loadUser(ctx),
			]);
			return readme ?? user.bio ?? "";
		},
		[mergedElsewhere.id]: async (ctx) => {
			// Global merged CRs excluding repos the contributor owns, so a
			// self-merged PR cannot manufacture reputation (min-merged-prs@2).
			const login = ctx.event.actor.login;
			const result = (await ctx
				.load("merged-elsewhere", () =>
					searchIssues(
						ctx,
						`author:${login} is:pr is:merged -user:${login}`,
						1,
					),
				)
				.catch(() => null)) as { total_count: number } | null;
			if (result === null) {
				signalUnavailable("global merge history unavailable");
			}
			return result.total_count;
		},
		[recentChangeRequestTimes.id]: async (ctx) => {
			// SHAPE-CHECK: fetch the signal's full declared history (30 days),
			// wide on purpose. Rules narrow with .last(); the signal never truncates.
			const login = ctx.event.actor.login;
			const since = new Date(Date.parse(ctx.now) - 30 * DAY_MS)
				.toISOString()
				.slice(0, 10);
			const result = (await ctx
				.load("recent-prs", () =>
					searchIssues(ctx, `author:${login} is:pr created:>=${since}`, 100),
				)
				.catch(() => null)) as { items: { created_at: string }[] } | null;
			// Matches reads.ts: a failed read yields an empty list, not a skip.
			return (result?.items ?? []).map((item) => item.created_at);
		},
		[mergedInRepo.id]: async (ctx) => {
			const login = ctx.event.actor.login;
			const result = (await ctx
				.load("merged-in-repo", () =>
					searchIssues(
						ctx,
						`repo:${repoOf(ctx.event)} author:${login} is:pr is:merged`,
						1,
					),
				)
				.catch(() => null)) as { total_count: number } | null;
			// Matches reads.ts: a failed read counts as zero, not a skip.
			return result?.total_count ?? 0;
		},
		[issuesOpenedInRepo.id]: async (ctx) => {
			const login = ctx.event.actor.login;
			const result = (await ctx
				.load("issues-in-repo", () =>
					searchIssues(
						ctx,
						`repo:${repoOf(ctx.event)} author:${login} is:issue`,
						1,
					),
				)
				.catch(() => null)) as { total_count: number } | null;
			if (result === null) {
				signalUnavailable("issue history unavailable");
			}
			return result.total_count;
		},
		[closedUnmergedInRepo.id]: async (ctx) => {
			const login = ctx.event.actor.login;
			const result = (await ctx
				.load("closed-unmerged-in-repo", () =>
					searchIssues(
						ctx,
						`repo:${repoOf(ctx.event)} author:${login} is:pr is:closed is:unmerged`,
						1,
					),
				)
				.catch(() => null)) as { total_count: number } | null;
			if (result === null) {
				signalUnavailable("closed change request history unavailable");
			}
			return result.total_count;
		},
		[commentedInRepo.id]: async (ctx) => {
			const login = ctx.event.actor.login;
			const result = (await ctx
				.load("commented-in-repo", () =>
					searchIssues(ctx, `repo:${repoOf(ctx.event)} commenter:${login}`, 1),
				)
				.catch(() => null)) as { total_count: number } | null;
			if (result === null) {
				signalUnavailable("comment history unavailable");
			}
			return result.total_count;
		},
		[isOrgMember.id]: async (ctx) => hasWriteAccess(await loadPermission(ctx)),
		[isMaintainer.id]: async (ctx) => hasWriteAccess(await loadPermission(ctx)),
		[title.id]: (ctx) => {
			if ("changeRequest" in ctx.event) {
				return ctx.event.changeRequest.title;
			}
			signalUnavailable("this event has no change request");
		},
		[filesChanged.id]: async (ctx) => (await loadPrFiles(ctx)).length,
		[changedPaths.id]: async (ctx) =>
			(await loadPrFiles(ctx)).map((file) => file.filename),
		[linesAdded.id]: async (ctx) =>
			(await loadPrFiles(ctx)).reduce((sum, file) => sum + file.additions, 0),
		[linesDeleted.id]: async (ctx) =>
			(await loadPrFiles(ctx)).reduce((sum, file) => sum + file.deletions, 0),
		[linesChanged.id]: async (ctx) =>
			(await loadPrFiles(ctx)).reduce(
				(sum, file) => sum + file.additions + file.deletions,
				0,
			),
		[commitCount.id]: async (ctx) => (await loadPrCommits(ctx)).length,
		[verifiedCommits.id]: async (ctx) =>
			(await loadPrCommits(ctx)).filter(
				(entry) => entry.commit.verification?.verified === true,
			).length,
		[allCommitsVerified.id]: async (ctx) => {
			const commits = await loadPrCommits(ctx);
			if (commits.length === 0) {
				signalUnavailable("this change request has no commits");
			}
			return commits.every(
				(entry) => entry.commit.verification?.verified === true,
			);
		},
		[patchByPath.id]: async (ctx) => {
			const files = await loadPrFiles(ctx);
			const patches: Record<string, string> = {};
			for (const file of files) {
				if (file.patch) {
					patches[file.filename] = file.patch;
				}
			}
			return patches;
		},
		[textByLocation.id]: async (ctx) => {
			// Insertion order IS the scan order: comment, title, then patch paths.
			const content: Record<string, string> = {};
			if (ctx.event.kind === "comment.created") {
				content.comment = ctx.event.comment.body;
			}
			if ("changeRequest" in ctx.event) {
				content.title = ctx.event.changeRequest.title;
				const files = await loadPrFiles(ctx);
				for (const file of files) {
					if (file.patch) {
						content[file.filename] = file.patch;
					}
				}
			}
			return content;
		},
		[login.id]: (ctx) => ctx.event.actor.login,
		[profileCompleteness.id]: async (ctx) =>
			profileFieldsPresent(await loadUser(ctx)),
		[isPublicProfile.id]: async (ctx) =>
			(await loadUser(ctx)).user_view_type === "public",
		[mergeRatioGlobal.id]: async (ctx) => {
			const author = `author:${ctx.event.actor.login}`;
			const merged = await loadSearchCount(
				ctx,
				"global-merged",
				`${author} is:pr is:merged`,
			);
			const closed = await loadSearchCount(
				ctx,
				"global-closed-unmerged",
				`${author} is:pr is:closed is:unmerged`,
			);
			if (merged === null || closed === null) {
				signalUnavailable("global merge history unavailable");
			}
			const decided = merged + closed;
			if (decided === 0) {
				signalUnavailable("no decided change requests anywhere yet");
			}
			return mergeRatioPercent(merged, decided);
		},
		[mergeRatioInRepo.id]: async (ctx) => {
			// Same load keys as mergedInRepo and closedUnmergedInRepo, so this
			// rides their fetches and adds zero API calls.
			const login = ctx.event.actor.login;
			const repo = repoOf(ctx.event);
			const merged = await loadSearchCount(
				ctx,
				"merged-in-repo",
				`repo:${repo} author:${login} is:pr is:merged`,
			);
			const closed = await loadSearchCount(
				ctx,
				"closed-unmerged-in-repo",
				`repo:${repo} author:${login} is:pr is:closed is:unmerged`,
			);
			if (merged === null || closed === null) {
				signalUnavailable("in-repo merge history unavailable");
			}
			const decided = merged + closed;
			if (decided === 0) {
				signalUnavailable("no decided change requests here yet");
			}
			return mergeRatioPercent(merged, decided);
		},
		[targetBranch.id]: (ctx) => changeRequestOf(ctx.event).baseRef,
		[sourceBranch.id]: (ctx) => changeRequestOf(ctx.event).headRef,
		[isDraft.id]: (ctx) => changeRequestOf(ctx.event).draft,
		[titleIsConventional.id]: (ctx) =>
			isConventionalSubject(changeRequestOf(ctx.event).title),
		[body.id]: (ctx) => prBody(ctx),
		[maintainerCanModify.id]: async (ctx) =>
			(await loadPrDetails(ctx)).maintainer_can_modify,
		[negativeReactions.id]: async (ctx) => {
			const reactions = (await loadIssueReactions(ctx)).reactions;
			return (reactions?.["-1"] ?? 0) + (reactions?.confused ?? 0);
		},
		[emojiCount.id]: async (ctx) =>
			countEmoji(`${changeRequestOf(ctx.event).title} ${await prBody(ctx)}`),
		[codeReferenceCount.id]: async (ctx) =>
			countCodeReferences(await prBody(ctx)),
		[linkedIssueCount.id]: async (ctx) =>
			extractIssueNumbers(await prBody(ctx)).length,
		[referencedIssueNumbers.id]: async (ctx) =>
			extractIssueNumbers(await prBody(ctx)),
		[fileExtensions.id]: async (ctx) =>
			distinctExtensions((await loadPrFiles(ctx)).map((file) => file.filename)),
		[addedCommentCount.id]: async (ctx) =>
			countAddedComments(await loadPrFiles(ctx)),
		[commitMessages.id]: async (ctx) =>
			(await loadPrCommits(ctx)).map((entry) => entry.commit.message ?? ""),
		[commitAuthors.id]: async (ctx) =>
			(await loadPrCommits(ctx)).map(
				(entry) => entry.author?.login ?? "unknown",
			),
		[allCommitsByAuthor.id]: async (ctx) => {
			const commits = await loadPrCommits(ctx);
			if (commits.length === 0) {
				signalUnavailable("this change request has no commits");
			}
			const author = ctx.event.actor.login.toLowerCase();
			return commits.every(
				(entry) => entry.author?.login?.toLowerCase() === author,
			);
		},
		[conventionalCommits.id]: async (ctx) =>
			allCommitsConventional(
				(await loadPrCommits(ctx)).map((entry) => entry.commit.message ?? ""),
			),
		[maxCommitMessageLength.id]: async (ctx) =>
			(await loadPrCommits(ctx)).reduce(
				(max, entry) => Math.max(max, (entry.commit.message ?? "").length),
				0,
			),
		[commentBody.id]: (ctx) => {
			if (ctx.event.kind === "comment.created") {
				return ctx.event.comment.body;
			}
			signalUnavailable("this event has no comment");
		},
	},
});

export type GithubForge = typeof githubForge;
