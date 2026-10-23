import { describe, expect, test } from "bun:test";
import { GithubReads } from "./reads.ts";

/**
 * min-merged-prs@2's read: the GLOBAL merged-CR search must EXCLUDE repos the
 * contributor owns (`-user:X`), so a self-created + self-merged PR can't
 * manufacture reputation — and it must degrade to null (never 0) when the search
 * fails, so the rule skips rather than treats a flaky read as "no reputation".
 */

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

const USER = {
	id: 7,
	created_at: "2020-01-01T00:00:00Z",
	followers: 1,
	following: 1,
	public_repos: 1,
	bio: null,
};

function readsWith(handler: (url: string) => Response): GithubReads {
	return new GithubReads({
		tokenFor: () => Promise.resolve("t"),
		appId: 1,
		fetchImpl: ((url: string | URL | Request) =>
			Promise.resolve(handler(String(url)))) as typeof fetch,
	});
}

describe("getContributorProfile — global merges exclude owned repos", () => {
	test("the global search excludes the contributor's own repos; self-owned merges don't count", async () => {
		const seen: string[] = [];
		const reads = readsWith((url) => {
			seen.push(url);
			if (url.includes("/users/octocat")) {
				return jsonResponse(USER);
			}
			// GLOBAL: authored, merged, NOT in a repo the contributor owns.
			if (url.includes("is%3Amerged") && url.includes("-user%3Aoctocat")) {
				return jsonResponse({ total_count: 9 });
			}
			// in-repo merged count.
			if (url.includes("repo%3A") && url.includes("is%3Amerged")) {
				return jsonResponse({ total_count: 2 });
			}
			return jsonResponse({ items: [], total_count: 0 });
		});

		const profile = await reads.getContributorProfile("acme/app", "octocat");

		// The exclusion qualifier was actually sent.
		expect(seen.some((u) => u.includes("-user%3Aoctocat"))).toBe(true);
		// Only the owner-excluded global count feeds mergedElsewhere.
		expect(profile.mergedElsewhere).toBe(9);
		expect(profile.mergedInRepo).toBe(2);
	});

	test("a failed global search degrades to null, not 0", async () => {
		const reads = readsWith((url) => {
			if (url.includes("/users/octocat")) {
				return jsonResponse(USER);
			}
			if (url.includes("-user%3Aoctocat")) {
				return jsonResponse("boom", 500);
			}
			if (url.includes("repo%3A") && url.includes("is%3Amerged")) {
				return jsonResponse({ total_count: 4 });
			}
			return jsonResponse({ items: [], total_count: 0 });
		});

		const profile = await reads.getContributorProfile("acme/app", "octocat");
		expect(profile.mergedElsewhere).toBeNull();
		expect(profile.mergedInRepo).toBe(4);
	});
});

const HEAD = "d125d3a".padEnd(40, "0");
const COMPARE_FILE = {
	filename: "qa4/d1b.md",
	status: "modified",
	additions: 1,
	deletions: 0,
	patch: "+bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
};
const COMPARE_COMMIT = {
	sha: HEAD,
	commit: { message: "add d1b", author: { date: "2026-10-23T17:40:00Z" } },
	author: { login: "octocat" },
};

describe("getDiff and getCommits read the event's own head", () => {
	test("with a head, the diff comes from the compare of base and that SHA", async () => {
		const seen: string[] = [];
		const reads = readsWith((url) => {
			seen.push(url);
			if (url.includes("/compare/")) {
				return jsonResponse({ files: [COMPARE_FILE], commits: [] });
			}
			return jsonResponse([]);
		});

		const diff = await reads.getDiff("acme/app", 151, {
			sha: HEAD,
			baseRef: "release/1.x",
		});

		expect(seen).toEqual([
			`https://api.github.com/repos/acme/app/compare/release%2F1.x...${HEAD}?per_page=100`,
		]);
		expect(diff).toEqual([
			{
				path: "qa4/d1b.md",
				status: "modified",
				additions: 1,
				deletions: 0,
				patch: COMPARE_FILE.patch,
				previousPath: undefined,
			},
		]);
	});

	test("with a head, the commits come from the same compare", async () => {
		const seen: string[] = [];
		const reads = readsWith((url) => {
			seen.push(url);
			return jsonResponse({ files: [], commits: [COMPARE_COMMIT] });
		});

		const commits = await reads.getCommits("acme/app", 151, {
			sha: HEAD,
			baseRef: "main",
		});

		expect(seen).toEqual([
			`https://api.github.com/repos/acme/app/compare/main...${HEAD}?per_page=100`,
		]);
		expect(commits).toEqual([
			{
				sha: HEAD,
				message: "add d1b",
				authorLogin: "octocat",
				authorEmail: null,
				authoredAt: "2026-10-23T17:40:00Z",
			},
		]);
	});

	test("without a head, the reads follow the change request's current head", async () => {
		const seen: string[] = [];
		const reads = readsWith((url) => {
			seen.push(url);
			return jsonResponse([]);
		});

		await reads.getDiff("acme/app", 151);
		await reads.getCommits("acme/app", 151);

		expect(seen).toEqual([
			"https://api.github.com/repos/acme/app/pulls/151/files?per_page=100",
			"https://api.github.com/repos/acme/app/pulls/151/commits?per_page=100",
		]);
	});
});
