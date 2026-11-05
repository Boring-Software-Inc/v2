import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { ruleEvidenceObjectSchema } from "./rules.ts";

describe("ruleEvidenceObjectSchema", () => {
	test.each(
		[
			null,
			undefined,
			false,
			0,
			"evidence",
			Symbol("evidence"),
			1n,
			[],
			[{}],
			() => ({}),
			runInNewContext("() => ({})"),
		].map((value) => ({ value })),
	)("rejects non-object evidence %p", ({ value }) => {
		expect(ruleEvidenceObjectSchema.safeParse(value).success).toBe(false);
	});

	test("preserves object identity, inherited fields and non-JSON fields", () => {
		const inherited = { accountAgeDays: 12 };
		const evidence = Object.assign(Object.create(inherited), {
			unavailable: undefined,
			callback: () => "not serialized",
		});
		const parsed = ruleEvidenceObjectSchema.parse(evidence);
		expect(parsed).toBe(evidence);
		expect(Object.getPrototypeOf(parsed)).toBe(inherited);
		expect(Object.hasOwn(parsed, "accountAgeDays")).toBe(false);
		expect(Object.hasOwn(parsed, "unavailable")).toBe(true);
	});

	test.each([
		{},
		Object.create(null),
		new Date("2026-01-01T00:00:00.000Z"),
		new Map([["key", 1]]),
		new Set([1]),
		Object(1),
		runInNewContext("({ accountAgeDays: 12 })"),
	])("accepts object evidence without cloning %p", (value) => {
		expect(ruleEvidenceObjectSchema.parse(value)).toBe(value);
	});
});
