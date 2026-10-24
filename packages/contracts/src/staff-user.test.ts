import { describe, expect, test } from "bun:test";
import {
	databuddyRuleSchema,
	flagSourceFromReason,
	isTripwireRule,
	mergeTripwireRules,
	staffBanInputSchema,
	staffSetFlagOverrideInputSchema,
	TRIPWIRE_RULE_FIELD,
} from "./staff-user.ts";

const theirEmailRule = {
	type: "email",
	operator: "ends_with",
	value: "@lumenlabs.dev",
	enabled: true,
	batch: false,
};

const theirUserRule = {
	type: "user_id",
	operator: "in",
	values: ["u-their"],
	enabled: false,
	batch: false,
};

describe("mergeTripwireRules", () => {
	test("puts Tripwire off and on rules first and keeps every other rule", () => {
		const merged = mergeTripwireRules([theirEmailRule, theirUserRule], {
			on: ["u2", "u1"],
			off: ["u3"],
		});
		expect(merged).toEqual([
			{
				type: "user_id",
				operator: "in",
				field: TRIPWIRE_RULE_FIELD.off,
				values: ["u3"],
				enabled: false,
				batch: false,
			},
			{
				type: "user_id",
				operator: "in",
				field: TRIPWIRE_RULE_FIELD.on,
				values: ["u1", "u2"],
				enabled: true,
				batch: false,
			},
			theirEmailRule,
			theirUserRule,
		]);
	});

	test("replaces the previous Tripwire rules instead of stacking them", () => {
		const first = mergeTripwireRules([theirEmailRule], {
			on: ["u1"],
			off: [],
		});
		const second = mergeTripwireRules(first, { on: ["u2"], off: [] });
		expect(second.filter(isTripwireRule)).toHaveLength(1);
		expect(second).toContainEqual(theirEmailRule);
		expect(second[0]).toMatchObject({ values: ["u2"] });
	});

	test("drops Tripwire rules when no overrides are left", () => {
		const first = mergeTripwireRules([theirUserRule], {
			on: ["u1"],
			off: ["u2"],
		});
		expect(mergeTripwireRules(first, { on: [], off: [] })).toEqual([
			theirUserRule,
		]);
	});

	test("keeps rules it cannot read untouched", () => {
		const strange = { kind: "future-rule", weight: 3 };
		expect(mergeTripwireRules([strange, null], { on: [], off: [] })).toEqual([
			strange,
			null,
		]);
	});

	test("is stable for the same input", () => {
		const a = mergeTripwireRules([theirEmailRule], {
			on: ["b", "a", "a"],
			off: [],
		});
		const b = mergeTripwireRules(a, { on: ["a", "b"], off: [] });
		expect(b).toEqual(a);
	});

	test("every rule it writes passes the Databuddy rule schema", () => {
		const merged = mergeTripwireRules([], { on: ["u1"], off: ["u2"] });
		for (const rule of merged) {
			expect(databuddyRuleSchema.safeParse(rule).success).toBe(true);
		}
	});
});

describe("flagSourceFromReason", () => {
	test("maps Databuddy evaluation reasons to a source", () => {
		expect(flagSourceFromReason("BOOLEAN_DEFAULT")).toBe("default");
		expect(flagSourceFromReason("ROLLOUT_ENABLED")).toBe("rollout");
		expect(flagSourceFromReason("USER_RULE_MATCH")).toBe("rule");
		expect(flagSourceFromReason("TARGET_GROUP_MATCH")).toBe("group");
		expect(flagSourceFromReason("ERROR")).toBe("unknown");
		expect(flagSourceFromReason(null)).toBe("unknown");
	});
});

describe("staff inputs", () => {
	test("flag keys must look like flag keys", () => {
		expect(
			staffSetFlagOverrideInputSchema.safeParse({
				userId: "u1",
				flagKey: "show-sidebar",
				choice: "on",
			}).success,
		).toBe(true);
		expect(
			staffSetFlagOverrideInputSchema.safeParse({
				userId: "u1",
				flagKey: "../etc",
				choice: "on",
			}).success,
		).toBe(false);
		expect(
			staffSetFlagOverrideInputSchema.safeParse({
				userId: "u1",
				flagKey: "show-sidebar",
				choice: "maybe",
			}).success,
		).toBe(false);
	});

	test("a ban needs a reason and takes an optional date", () => {
		expect(
			staffBanInputSchema.safeParse({ userId: "u1", reason: " ", endsAt: null })
				.success,
		).toBe(false);
		expect(
			staffBanInputSchema.safeParse({
				userId: "u1",
				reason: "Spam",
				endsAt: "2026-11-24",
			}).success,
		).toBe(true);
		expect(
			staffBanInputSchema.safeParse({
				userId: "u1",
				reason: "Spam",
				endsAt: "next week",
			}).success,
		).toBe(false);
	});
});
