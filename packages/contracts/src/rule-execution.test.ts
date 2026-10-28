import { describe, expect, test } from "bun:test";
import { ruleExecutes } from "./rule-execution.ts";

describe("ruleExecutes", () => {
	test("a rule with no stored row is off", () => {
		expect(ruleExecutes("account-age@1", undefined)).toBe(false);
		expect(ruleExecutes("ai-review@2", undefined)).toBe(false);
	});

	test("a stored row decides", () => {
		expect(ruleExecutes("account-age@1", true)).toBe(true);
		expect(ruleExecutes("account-age@1", false)).toBe(false);
	});
});
