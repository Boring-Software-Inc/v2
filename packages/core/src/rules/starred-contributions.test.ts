import { expect, test } from "bun:test";
import { evaluateRule } from "./define.ts";
import { mergedPrRepoStars, ownedRepoStars } from "./starred-contributions.ts";
import { fixtureContext } from "./test-context.ts";

test("partial history can prove a pass but cannot prove a failure", async () => {
	const ctx = await fixtureContext({
		countStarredContributions: async (query) => {
			expect(query).toEqual({
				kind: "owned-repositories",
				minStars: 50_000,
				min: query.min,
			});
			return { count: 1, complete: false };
		},
	});
	expect(
		await evaluateRule(ownedRepoStars, ctx, { minStars: 50_000, min: 1 }),
	).toMatchObject({ status: "evaluated", passed: true });
	expect(
		await evaluateRule(ownedRepoStars, ctx, { minStars: 50_000, min: 2 }),
	).toMatchObject({ status: "skipped", evidence: null });
});

test("complete history below the minimum fails with the requested ownership filter", async () => {
	const config = {
		minRepoStars: 50_000,
		min: 5,
		repoOwnership: "exclude-author" as const,
	};
	const ctx = await fixtureContext({
		countStarredContributions: async (query) => {
			expect(query).toEqual({ kind: "merged-pull-requests", ...config });
			return { count: 3, complete: true };
		},
	});
	expect(await evaluateRule(mergedPrRepoStars, ctx, config)).toMatchObject({
		status: "evaluated",
		passed: false,
		evidence: { matchingCount: 3, complete: true },
	});
});
