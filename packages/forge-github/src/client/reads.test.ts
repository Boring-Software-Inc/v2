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
