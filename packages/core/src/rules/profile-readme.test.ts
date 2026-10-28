import { describe, expect, test } from "bun:test";
import { evaluateRule } from "./define.ts";
import { profileReadme } from "./profile-readme.ts";
import { fixtureContext, fixtureContributor } from "./test-context.ts";

describe("profile-readme@1", () => {
	test("available text still evaluates without dates, counts, history or membership", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({
				createdAt: null,
				followers: null,
				publicRepos: null,
				mergedInRepo: null,
				mergedElsewhere: null,
				recentChangeRequestTimes: null,
				isOrgMember: null,
				isMaintainer: null,
			}),
		});
		const result = await evaluateRule(profileReadme, ctx, { minLength: 32 });
		expect(result.status).toBe("evaluated");
		expect(result.passed).toBe(true);
		expect(result.evidence).toMatchObject({ hasProfileText: true });
	});

	test("passes a contributor with real profile text", async () => {
		const result = await evaluateRule(profileReadme, await fixtureContext(), {
			minLength: 32,
		});
		expect(result.passed).toBe(true);
		expect(result.evidence).toMatchObject({ hasProfileText: true });
	});

	test("blocks the empty ghost profile", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({ profileText: null }),
		});
		const result = await evaluateRule(profileReadme, ctx, { minLength: 32 });
		expect(result.passed).toBe(false);
		expect(result.evidence).toEqual({
			hasProfileText: false,
			length: 0,
			minLength: 32,
		});
	});

	test("whitespace-only text counts as empty", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({ profileText: "   \n " }),
		});
		const result = await evaluateRule(profileReadme, ctx, { minLength: 1 });
		expect(result.passed).toBe(false);
	});

	test("skips without a contributor profile", async () => {
		const result = await evaluateRule(
			profileReadme,
			await fixtureContext({ contributor: null }),
			{ minLength: 32 },
		);
		expect(result.status).toBe("skipped");
	});
});
