import { describe, expect, test } from "bun:test";
import { evaluateRule } from "./define.ts";
import { minMergedPrs, minMergedPrsV2 } from "./min-merged-prs.ts";
import { fixtureContext, fixtureContributor } from "./test-context.ts";

describe("min-merged-prs@1 (frozen)", () => {
	test("available local history evaluates without global or profile metadata", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({
				createdAt: null,
				followers: null,
				publicRepos: null,
				mergedElsewhere: null,
				recentChangeRequestTimes: null,
				isOrgMember: null,
				isMaintainer: null,
			}),
		});
		const result = await evaluateRule(minMergedPrs, ctx, { min: 3 });
		expect(result.status).toBe("evaluated");
		expect(result.passed).toBe(true);
		expect(result.evidence).toEqual({ mergedInRepo: 3, min: 3 });
	});

	test("passes at or above the threshold", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({ mergedInRepo: 3 }),
		});
		const result = await evaluateRule(minMergedPrs, ctx, { min: 3 });
		expect(result.passed).toBe(true);
		expect(result.evidence).toEqual({ mergedInRepo: 3, min: 3 });
	});

	test("blocks below the threshold", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({ mergedInRepo: 0 }),
		});
		const result = await evaluateRule(minMergedPrs, ctx, { min: 1 });
		expect(result.passed).toBe(false);
	});

	test("skips unavailable local history even with a zero threshold", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({ mergedInRepo: null }),
		});
		const result = await evaluateRule(minMergedPrs, ctx, { min: 0 });
		expect(result.status).toBe("skipped");
		expect(result.evidence).toBeNull();
		expect(result.reason).toBe(
			"Tripwire could not read the contributor's merge history in this repository.",
		);
	});

	test("skips without a contributor profile", async () => {
		const result = await evaluateRule(
			minMergedPrs,
			await fixtureContext({ contributor: null }),
			{ min: 1 },
		);
		expect(result.status).toBe("skipped");
	});
});

describe("min-merged-prs@2 (global, with local exemption)", () => {
	const config = { min: 3, trustedAfter: 5 };

	test("passes at/above the GLOBAL threshold (not locally trusted)", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({ mergedElsewhere: 3, mergedInRepo: 0 }),
		});
		const result = await evaluateRule(minMergedPrsV2, ctx, config);
		expect(result.passed).toBe(true);
		expect(result.evidence).toEqual({
			mergedElsewhere: 3,
			mergedInRepo: 0,
			min: 3,
			trustedAfter: 5,
		});
	});

	test("blocks below the global threshold", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({ mergedElsewhere: 1, mergedInRepo: 0 }),
		});
		const result = await evaluateRule(minMergedPrsV2, ctx, config);
		expect(result.passed).toBe(false);
	});

	test("EXEMPTION: a trusted local contributor passes with ZERO global merges", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({ mergedElsewhere: 0, mergedInRepo: 5 }),
		});
		const result = await evaluateRule(minMergedPrsV2, ctx, config);
		expect(result.passed).toBe(true);
	});

	test("skips when the GLOBAL count is unavailable — never guesses", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({ mergedElsewhere: null }),
		});
		const result = await evaluateRule(minMergedPrsV2, ctx, config);
		expect(result.status).toBe("skipped");
		expect(result.reason).toBe(
			"Tripwire could not read the contributor's merge history in other repositories.",
		);
		expect(result.evidence).toBeNull();
	});

	test("skips when local history is unavailable independently of global history", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({
				mergedInRepo: null,
				mergedElsewhere: 10,
			}),
		});
		const result = await evaluateRule(minMergedPrsV2, ctx, config);
		expect(result.status).toBe("skipped");
		expect(result.reason).toBe(
			"Tripwire could not read the contributor's merge history in this repository.",
		);
		expect(result.evidence).toBeNull();
	});

	test("skips without a contributor profile", async () => {
		const result = await evaluateRule(
			minMergedPrsV2,
			await fixtureContext({ contributor: null }),
			config,
		);
		expect(result.status).toBe("skipped");
	});
});
