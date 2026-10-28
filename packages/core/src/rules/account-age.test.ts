import { describe, expect, test } from "bun:test";
import { accountAge } from "./account-age.ts";
import { evaluateRule } from "./define.ts";
import { fixtureContext, fixtureContributor } from "./test-context.ts";

describe("account-age@1", () => {
	test("passes when the account is old enough", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({
				createdAt: "2020-01-01T00:00:00.000Z",
			}),
		});
		const result = await evaluateRule(accountAge, ctx, { minDays: 30 });
		expect(result.status).toBe("evaluated");
		expect(result.passed).toBe(true);
		expect(result.evidence).toMatchObject({ minDays: 30 });
		expect(
			(result.evidence as { accountAgeDays: number }).accountAgeDays,
		).toBeGreaterThan(2000);
	});

	test("blocks a fresh account", async () => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({
				createdAt: "2026-07-09T00:00:00.000Z",
			}),
		});
		const result = await evaluateRule(accountAge, ctx, { minDays: 30 });
		expect(result.passed).toBe(false);
		expect(result.evidence).toMatchObject({ accountAgeDays: 2 });
	});

	test.each([
		null,
		"not-a-date",
	])("skips an unavailable or invalid creation date: %s", async (createdAt) => {
		const ctx = await fixtureContext({
			contributor: fixtureContributor({ createdAt }),
		});
		const result = await evaluateRule(accountAge, ctx, { minDays: 0 });
		expect(result.status).toBe("skipped");
		expect(result.passed).toBe(false);
		expect(result.evidence).toBeNull();
		expect(result.reason).toBe(
			"Tripwire could not read when the contributor's account was created.",
		);
	});

	test("skips (never throws) without a contributor profile", async () => {
		const ctx = await fixtureContext({ contributor: null });
		const result = await evaluateRule(accountAge, ctx, { minDays: 30 });
		expect(result.status).toBe("skipped");
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("could not read");
	});

	test("invalid config skips instead of throwing", async () => {
		const result = await evaluateRule(accountAge, await fixtureContext(), {
			minDays: "soon",
		});
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("invalid config");
	});

	test("deterministic over the same context", async () => {
		const ctx = await fixtureContext();
		const a = await evaluateRule(accountAge, ctx, { minDays: 30 });
		const b = await evaluateRule(accountAge, ctx, { minDays: 30 });
		expect(a).toEqual(b);
	});
});
