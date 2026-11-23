import { describe, expect, test } from "bun:test";
import { duplicateRepoNames, qualifiedRepoLabel } from "#/lib/repo-label";

describe("repository labels", () => {
	test("finds only names that need disambiguation", () => {
		expect(
			duplicateRepoNames([
				{ name: "scratch" },
				{ name: "api" },
				{ name: "scratch" },
			]),
		).toEqual(new Set(["scratch"]));
	});

	test("names a duplicate by owner and forge", () => {
		expect(
			qualifiedRepoLabel({
				forge: "gitcafe",
				owner: "boring",
				name: "scratch",
			}),
		).toBe("boring/scratch · GitCafe");
	});
});
