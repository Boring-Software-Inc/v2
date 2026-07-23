import { describe, expect, test } from "bun:test";
import type { RepoScopedEvent } from "@tripwire/contracts";
import {
	createForgeSignalCtx,
	defineForge,
	SignalUnavailableError,
} from "@tripwire/sdk";
import { GithubHttp } from "./client/http.ts";
import { githubForge } from "./signals.ts";

/**
 * The Phase 1 proof: producers share loaders, so evaluating many signals
 * costs the same API volume as today's monolithic pre-fetch (§5.8), and
 * event-derived signals cost zero calls.
 */

const NOW = "2026-07-21T12:00:00.000Z";

const prEvent: RepoScopedEvent = {
	id: "evt-1",
	forge: "github",
	deliveryId: "d-1",
	repo: { owner: "acme", name: "widgets", fullName: "acme/widgets" },
	actor: { login: "mallory", externalId: "77" },
	occurredAt: NOW,
	receivedAt: NOW,
	kind: "change-request.opened",
	changeRequest: {
		number: 42,
		title: "Add feature",
		headSha: "abc123",
		baseRef: "main",
		headRef: "feature",
		draft: false,
		url: "https://github.com/acme/widgets/pull/42",
	},
};

function fakeResponses(): Record<string, unknown> {
	return {
		"/users/mallory": {
			id: 77,
			created_at: "2026-07-11T12:00:00.000Z",
			followers: 3,
			following: 9,
			public_repos: 5,
			public_gists: 2,
			hireable: null,
			company: "@acme",
			location: null,
			bio: "hi",
			name: null,
			blog: null,
			email: null,
			twitter_username: null,
			user_view_type: "public",
		},
		"/repos/mallory/mallory/contents/README.md?ref=HEAD": {
			content: Buffer.from("my profile readme").toString("base64"),
			encoding: "base64",
		},
		[`/search/issues?q=${encodeURIComponent("repo:acme/widgets author:mallory is:pr is:merged")}&per_page=1`]:
			{ total_count: 2 },
		[`/search/issues?q=${encodeURIComponent("author:mallory is:pr is:merged -user:mallory")}&per_page=1`]:
			{ total_count: 4 },
		[`/search/issues?q=${encodeURIComponent("author:mallory is:pr created:>=2026-06-21")}&per_page=100`]:
			{ items: [{ created_at: "2026-07-20T00:00:00.000Z" }] },
		"/repos/acme/widgets/collaborators/mallory/permission": {
			permission: "read",
		},
		"/repos/acme/widgets/pulls/42/files?per_page=100": [
			{
				filename: "src/a.ts",
				additions: 10,
				deletions: 4,
				patch: "@@ -1 +1 @@",
			},
			{ filename: "docs/b.md", additions: 1, deletions: 0 },
		],
		"/repos/acme/widgets/pulls/42/commits?per_page=100": [
			{
				commit: { message: "feat: a", verification: { verified: true } },
				author: { login: "mallory" },
			},
			{
				commit: { message: "fix: b", verification: { verified: false } },
				author: { login: "mallory" },
			},
			{ commit: { message: "tweak things" }, author: null },
		],
		"/repos/acme/widgets/pulls/42": {
			body: "Closes #12 with foo/bar.ts and run() 🚀",
			maintainer_can_modify: true,
		},
		"/repos/acme/widgets/issues/42": {
			reactions: { "-1": 1, confused: 2 },
		},
		[`/search/issues?q=${encodeURIComponent("author:mallory is:pr is:merged")}&per_page=1`]:
			{ total_count: 10 },
		[`/search/issues?q=${encodeURIComponent("author:mallory is:pr is:closed is:unmerged")}&per_page=1`]:
			{ total_count: 30 },
		[`/search/issues?q=${encodeURIComponent("author:mallory is:pr")}&per_page=1`]:
			{ total_count: 9 },
		[`/search/issues?q=${encodeURIComponent("repo:acme/widgets author:mallory is:issue")}&per_page=1`]:
			{ total_count: 3 },
		[`/search/issues?q=${encodeURIComponent("repo:acme/widgets author:mallory is:pr is:closed is:unmerged")}&per_page=1`]:
			{ total_count: 1 },
		[`/search/issues?q=${encodeURIComponent("repo:acme/widgets commenter:mallory")}&per_page=1`]:
			{ total_count: 6 },
		// A FULL page (100 events) whose oldest entry predates the 7 day
		// history: pagination must stop after page 1 even though page 2 exists.
		"/users/mallory/events?per_page=100&page=1": [
			{ type: "ForkEvent", created_at: "2026-07-21T09:00:00.000Z" },
			{ type: "PushEvent", created_at: "2026-07-21T08:00:00.000Z" },
			{ type: "ForkEvent", created_at: "2026-07-20T12:00:00.000Z" },
			...Array.from({ length: 96 }, (_, i) => ({
				type: "PushEvent",
				created_at: `2026-07-${String(19 - (i % 5)).padStart(2, "0")}T00:00:00.000Z`,
			})),
			{ type: "ForkEvent", created_at: "2026-07-01T00:00:00.000Z" },
		],
		"/users/mallory/events?per_page=100&page=2": [
			{ type: "ForkEvent", created_at: "2026-06-30T00:00:00.000Z" },
		],
	};
}

function makeCtx(event: RepoScopedEvent = prEvent) {
	const calls: string[] = [];
	const responses = fakeResponses();
	const http = new GithubHttp({
		tokenFor: async () => "test-token",
		fetchImpl: (async (input: string | URL | Request) => {
			const path = String(input).replace("https://api.github.com", "");
			calls.push(path);
			const body = responses[path];
			if (body === undefined) {
				return new Response("not found", { status: 404 });
			}
			return Response.json(body);
		}) as unknown as typeof fetch,
	});
	return { ctx: createForgeSignalCtx({ forge: http, event, now: NOW }), calls };
}

function produce(id: keyof typeof githubForge.produces, ctx: unknown) {
	const producer = githubForge.produces[id];
	if (!producer) {
		throw new Error(`no producer for ${id}`);
	}
	// Async wrapper so a synchronous signalUnavailable throw becomes a rejection.
	// biome-ignore lint/suspicious/noExplicitAny: test drives producers generically
	return (async () => producer(ctx as any))();
}

describe("github forge signals", () => {
	test("five contributor signals share one user fetch", async () => {
		const { ctx, calls } = makeCtx();
		const [age, fol, fing, repos] = await Promise.all([
			produce("contributor.accountAge", ctx),
			produce("contributor.followers", ctx),
			produce("contributor.following", ctx),
			produce("contributor.publicRepos", ctx),
		]);
		expect(age).toBe(10);
		expect(fol).toBe(3);
		expect(fing).toBe(9);
		expect(repos).toBe(5);
		expect(calls.filter((c) => c === "/users/mallory")).toHaveLength(1);
		expect(calls).toHaveLength(1);
	});

	test("three pr signals share one files fetch", async () => {
		const { ctx, calls } = makeCtx();
		const [count, paths, patches] = await Promise.all([
			produce("pr.filesChanged", ctx),
			produce("pr.changedPaths", ctx),
			produce("pr.patchByPath", ctx),
		]);
		expect(count).toBe(2);
		expect(paths).toEqual(["src/a.ts", "docs/b.md"]);
		expect(patches).toEqual({ "src/a.ts": "@@ -1 +1 @@" });
		expect(calls).toHaveLength(1);
	});

	test("the original signal set on a PR event costs seven calls, same as the old pre-fetch", async () => {
		const { ctx, calls } = makeCtx();
		const ids = [
			"contributor.accountAge",
			"contributor.followers",
			"contributor.following",
			"contributor.publicRepos",
			"contributor.profileText",
			"contributor.mergedElsewhere",
			"contributor.recentChangeRequestTimes",
			"repoRelation.mergedInRepo",
			"repoRelation.isOrgMember",
			"repoRelation.isMaintainer",
			"pr.title",
			"pr.filesChanged",
			"pr.changedPaths",
			"pr.patchByPath",
			"pr.textByLocation",
		] as (keyof typeof githubForge.produces)[];
		const values = Object.fromEntries(
			await Promise.all(ids.map(async (id) => [id, await produce(id, ctx)])),
		);
		expect(values["contributor.profileText"]).toBe("my profile readme");
		expect(values["contributor.mergedElsewhere"]).toBe(4);
		expect(values["repoRelation.mergedInRepo"]).toBe(2);
		expect(values["repoRelation.isMaintainer"]).toBe(false);
		expect(values["pr.title"]).toBe("Add feature");
		expect(values["contributor.recentChangeRequestTimes"]).toEqual([
			"2026-07-20T00:00:00.000Z",
		]);
		// user, profile readme, 3 searches, permission, pr files. Today's
		// pre-fetch spends the same 6 profile calls + 1 diff call (plus a
		// commits call the signal path no longer needs).
		expect(calls).toHaveLength(7);
		expect(new Set(calls).size).toBe(7);
	});

	test("event-derived signals cost zero API calls", async () => {
		const { ctx, calls } = makeCtx();
		await expect(produce("pr.title", ctx)).resolves.toBe("Add feature");
		expect(calls).toHaveLength(0);
	});

	test("every signal in the expanded registry costs seventeen calls, shared loaders deduped", async () => {
		const { ctx, calls } = makeCtx();
		const ids = Object.keys(githubForge.produces).filter(
			(id) => id !== "comment.body",
		) as (keyof typeof githubForge.produces)[];
		const values = Object.fromEntries(
			await Promise.all(ids.map(async (id) => [id, await produce(id, ctx)])),
		);
		expect(values["contributor.publicGists"]).toBe(2);
		expect(values["contributor.hireable"]).toBe(false);
		expect(values["contributor.company"]).toBe("@acme");
		expect(values["contributor.location"]).toBe("");
		expect(values["contributor.prsOpened"]).toBe(9);
		expect(values["pr.linesAdded"]).toBe(11);
		expect(values["pr.linesDeleted"]).toBe(4);
		expect(values["pr.linesChanged"]).toBe(15);
		expect(values["pr.commitCount"]).toBe(3);
		expect(values["pr.verifiedCommits"]).toBe(1);
		expect(values["pr.allCommitsVerified"]).toBe(false);
		expect(values["repoRelation.issuesOpenedInRepo"]).toBe(3);
		expect(values["repoRelation.closedUnmergedInRepo"]).toBe(1);
		expect(values["repoRelation.commentedInRepo"]).toBe(6);
		// The round-2 additions.
		expect(values["contributor.login"]).toBe("mallory");
		expect(values["contributor.profileCompleteness"]).toBe(4);
		expect(values["contributor.isPublicProfile"]).toBe(true);
		expect(values["contributor.mergeRatioGlobal"]).toBe(25);
		expect(values["repoRelation.mergeRatioInRepo"]).toBe(67);
		expect(values["pr.targetBranch"]).toBe("main");
		expect(values["pr.sourceBranch"]).toBe("feature");
		expect(values["pr.isDraft"]).toBe(false);
		expect(values["pr.titleIsConventional"]).toBe(false);
		expect(values["pr.body"]).toBe("Closes #12 with foo/bar.ts and run() 🚀");
		expect(values["pr.maintainerCanModify"]).toBe(true);
		expect(values["pr.negativeReactions"]).toBe(3);
		expect(values["pr.emojiCount"]).toBe(1);
		expect(values["pr.codeReferenceCount"]).toBe(2);
		expect(values["pr.linkedIssueCount"]).toBe(1);
		expect(values["pr.referencedIssueNumbers"]).toEqual(["12"]);
		expect(values["pr.fileExtensions"]).toEqual(["ts", "md"]);
		expect(values["pr.addedCommentCount"]).toBe(0);
		expect(values["pr.commitMessages"]).toEqual([
			"feat: a",
			"fix: b",
			"tweak things",
		]);
		expect(values["pr.commitAuthors"]).toEqual([
			"mallory",
			"mallory",
			"unknown",
		]);
		expect(values["pr.allCommitsByAuthor"]).toBe(false);
		expect(values["pr.conventionalCommits"]).toBe(false);
		expect(values["pr.maxCommitMessageLength"]).toBe(12);
		// The original 13, plus pr-details, issue-reactions, and the two global
		// merge searches. The two in-repo merge-ratio counts ride existing
		// searches, so they add nothing.
		expect(calls).toHaveLength(17);
		expect(new Set(calls).size).toBe(17);
	});

	test("the pr-details cluster feeds body and maintainer-can-modify in one call", async () => {
		const { ctx, calls } = makeCtx();
		const [prBody, canModify, emoji] = await Promise.all([
			produce("pr.body", ctx),
			produce("pr.maintainerCanModify", ctx),
			produce("pr.codeReferenceCount", ctx),
		]);
		expect(prBody).toBe("Closes #12 with foo/bar.ts and run() 🚀");
		expect(canModify).toBe(true);
		expect(emoji).toBe(2);
		expect(calls).toEqual(["/repos/acme/widgets/pulls/42"]);
	});

	test("both merge-ratio signals ride the in-repo searches, adding no calls", async () => {
		const { ctx, calls } = makeCtx();
		await Promise.all([
			produce("repoRelation.mergedInRepo", ctx),
			produce("repoRelation.closedUnmergedInRepo", ctx),
			produce("repoRelation.mergeRatioInRepo", ctx),
		]);
		// mergeRatioInRepo shares the merged and closed-unmerged search keys.
		expect(calls).toHaveLength(2);
		expect(new Set(calls).size).toBe(2);
	});

	test("commit-derived signals share the one commits fetch", async () => {
		const { ctx, calls } = makeCtx();
		await Promise.all([
			produce("pr.commitMessages", ctx),
			produce("pr.commitAuthors", ctx),
			produce("pr.allCommitsByAuthor", ctx),
			produce("pr.conventionalCommits", ctx),
			produce("pr.maxCommitMessageLength", ctx),
		]);
		expect(calls).toEqual([
			"/repos/acme/widgets/pulls/42/commits?per_page=100",
		]);
	});

	test("a fetch blip on any fetch-backed cluster skips the rule, never fails the run", async () => {
		// A PR number the fixtures do not answer: every /pulls/999 and /issues/999
		// read 404s. The producer must surface SignalUnavailableError (the skip
		// signal), not a raw throw that would fail the whole run.
		const missingPr = {
			...prEvent,
			changeRequest: { ...prEvent.changeRequest, number: 999 },
		};
		const { ctx } = makeCtx(missingPr);
		// pr-files cluster.
		await expect(produce("pr.filesChanged", ctx)).rejects.toBeInstanceOf(
			SignalUnavailableError,
		);
		// pr-commits cluster.
		await expect(produce("pr.commitCount", ctx)).rejects.toBeInstanceOf(
			SignalUnavailableError,
		);
		// pr-details cluster (body and everything derived from it).
		await expect(produce("pr.body", ctx)).rejects.toBeInstanceOf(
			SignalUnavailableError,
		);
		await expect(produce("pr.emojiCount", ctx)).rejects.toBeInstanceOf(
			SignalUnavailableError,
		);
		// issue-reactions cluster.
		await expect(produce("pr.negativeReactions", ctx)).rejects.toBeInstanceOf(
			SignalUnavailableError,
		);
	});

	test("the weak account signals ride the one user fetch", async () => {
		const { ctx, calls } = makeCtx();
		await Promise.all([
			produce("contributor.publicGists", ctx),
			produce("contributor.hireable", ctx),
			produce("contributor.company", ctx),
			produce("contributor.location", ctx),
			produce("contributor.accountAge", ctx),
		]);
		expect(calls).toHaveLength(1);
	});

	test("the commit integrity trio shares one commits fetch", async () => {
		const { ctx, calls } = makeCtx();
		await Promise.all([
			produce("pr.commitCount", ctx),
			produce("pr.verifiedCommits", ctx),
			produce("pr.allCommitsVerified", ctx),
		]);
		expect(calls).toHaveLength(1);
	});

	test("the events feed stops paginating once the 7d window is covered", async () => {
		const { ctx, calls } = makeCtx();
		const times = await produce("contributor.recentForkTimes", ctx);
		// Page 1 is full but its oldest event predates the window: no page 2.
		expect(calls).toEqual(["/users/mallory/events?per_page=100&page=1"]);
		// Only fork events inside the 7 day window, newest first.
		expect(times).toEqual([
			"2026-07-21T09:00:00.000Z",
			"2026-07-20T12:00:00.000Z",
		]);
	});

	test("textByLocation assembles the map in scan order on a PR event", async () => {
		const { ctx } = makeCtx();
		const content = (await produce("pr.textByLocation", ctx)) as Record<
			string,
			string
		>;
		expect(Object.keys(content)).toEqual(["title", "src/a.ts"]);
		expect(content.title).toBe("Add feature");
	});

	test("comment.body on a PR event is unavailable, not an error", async () => {
		const { ctx } = makeCtx();
		await expect(produce("comment.body", ctx)).rejects.toBeInstanceOf(
			SignalUnavailableError,
		);
	});

	test("a failed global-merge search is unavailable, a failed in-repo search counts zero", async () => {
		const { ctx } = makeCtx();
		// Unknown login busts every canned response, so the searches 404.
		const brokenEvent = {
			...prEvent,
			actor: { login: "ghost", externalId: "0" },
		};
		const { ctx: brokenCtx } = makeCtx(brokenEvent);
		await expect(
			produce("contributor.mergedElsewhere", brokenCtx),
		).rejects.toBeInstanceOf(SignalUnavailableError);
		await expect(produce("repoRelation.mergedInRepo", brokenCtx)).resolves.toBe(
			0,
		);
		await expect(produce("contributor.mergedElsewhere", ctx)).resolves.toBe(4);
	});
});

describe("defineForge type flow", () => {
	test("a producer's return type is enforced against the signal's declared type", () => {
		// Compile-time proof, mirrored from the approved spike.
		defineForge<GithubHttp>()({
			id: "bad",
			produces: {
				// @ts-expect-error accountAge is a number signal; a text producer must not compile
				"contributor.accountAge": async () => "not a number",
			},
		});
		expect(true).toBe(true);
	});
});
