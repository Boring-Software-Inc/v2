import { describe, expect, test } from "bun:test";
import { rerunRulesLine } from "#/lib/activity.functions";

describe("rerunRulesLine", () => {
	test("empty set names the gap", () => {
		expect(rerunRulesLine([])).toBe(
			"no rules will evaluate — enable a rule or workflow first.",
		);
	});

	test("lists one, two, three by name", () => {
		expect(rerunRulesLine(["account age"])).toBe("re-runs: account age");
		expect(rerunRulesLine(["account age", "crypto address"])).toBe(
			"re-runs: account age and crypto address",
		);
		expect(
			rerunRulesLine(["account age", "crypto address", "honeypot paths"]),
		).toBe("re-runs: account age, crypto address, and honeypot paths");
	});

	test("caps at three named + and N more", () => {
		expect(
			rerunRulesLine([
				"account age",
				"crypto address",
				"honeypot paths",
				"max files changed",
				"english only",
			]),
		).toBe("re-runs: account age, crypto address, honeypot paths, and 2 more");
	});
});
