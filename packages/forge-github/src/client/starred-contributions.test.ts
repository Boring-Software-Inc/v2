import { expect, test } from "bun:test";
import { GithubReads } from "./reads.ts";

const author = { login: "octocat", externalId: "77" };
const publicRepo = (stargazerCount: number, owner: string) => ({
	stargazerCount,
	visibility: "PUBLIC",
	owner: { id: owner },
});

function page(nodes: readonly unknown[], endCursor: string | null = null) {
	return Response.json({
		data: {
			user: {
				id: "author",
				databaseId: 77,
				history: {
					nodes,
					pageInfo: { hasNextPage: endCursor !== null, endCursor },
				},
			},
		},
	});
}

test("reads only owned public repositories and stops below the inclusive star threshold", async () => {
	const fetchImpl: typeof fetch = Object.assign(
		async (_url: unknown, init?: RequestInit) => {
			expect(init?.body).toContain("ownerAffiliations: [OWNER]");
			return page(
				[
					{ id: "first", ...publicRepo(50_000, "author") },
					{ id: "second", ...publicRepo(49_999, "author") },
				],
				"more",
			);
		},
		{ preconnect: fetch.preconnect },
	);
	const reads = new GithubReads({
		tokenFor: async () => "token",
		appId: 1,
		fetchImpl,
	});
	expect(
		await reads.countStarredContributions("tripwire/scratch", author, {
			kind: "owned-repositories",
			minStars: 50_000,
			min: 2,
		}),
	).toEqual({ count: 1, complete: true });
});

test("counts distinct merged pull requests, checks destination ownership, and continues to the next page", async () => {
	let calls = 0;
	const fetchImpl: typeof fetch = Object.assign(
		async (_url: unknown, init?: RequestInit) => {
			calls++;
			expect(init?.body).toContain("states: [MERGED]");
			if (calls === 1)
				return page(
					[
						{ id: "self", repository: publicRepo(100_000, "author") },
						{ id: "below", repository: publicRepo(49_999, "other") },
						{
							id: "private",
							repository: {
								...publicRepo(100_000, "other"),
								visibility: "PRIVATE",
							},
						},
						{ id: "first", repository: publicRepo(50_000, "other") },
					],
					"more",
				);
			expect(init?.body).toContain('"cursor":"more"');
			return page([
				{ id: "first", repository: publicRepo(50_000, "other") },
				{ id: "second", repository: publicRepo(50_000, "other") },
			]);
		},
		{ preconnect: fetch.preconnect },
	);
	const reads = new GithubReads({
		tokenFor: async () => "token",
		appId: 1,
		fetchImpl,
	});
	expect(
		await reads.countStarredContributions("tripwire/scratch", author, {
			kind: "merged-pull-requests",
			minRepoStars: 50_000,
			min: 3,
			repoOwnership: "exclude-author",
		}),
	).toEqual({ count: 2, complete: true });
	expect(calls).toBe(2);
});
