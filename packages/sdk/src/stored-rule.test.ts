import { describe, expect, test } from "bun:test";
import { storedRuleIssue } from "./stored-rule.ts";

describe("storedRuleIssue", () => {
	test("a sound rule passes", () => {
		expect(
			storedRuleIssue({
				when: { id: "contributor.accountAge" },
				comparison: { kind: "under", args: [7] },
			}),
		).toBeNull();
		expect(
			storedRuleIssue({
				when: {
					id: "contributor.recentForkTimes",
					transform: { kind: "lastCount", window: "24h" },
				},
				comparison: { kind: "atMost", args: [20] },
			}),
		).toBeNull();
	});

	test("unknown signals, wrong verbs, and over-wide windows are named", () => {
		expect(
			storedRuleIssue({
				when: { id: "contributor.nope" },
				comparison: { kind: "under", args: [1] },
			}),
		).toContain("unknown signal");
		expect(
			storedRuleIssue({
				when: { id: "contributor.accountAge" },
				comparison: { kind: "has", args: ["x"] },
			}),
		).toContain("does not apply");
		expect(
			storedRuleIssue({
				when: {
					id: "contributor.recentForkTimes",
					transform: { kind: "lastCount", window: "30d" },
				},
				comparison: { kind: "atMost", args: [1] },
			}),
		).toContain("only provides 7d history");
	});

	test("a raw rate signal without a window is rejected", () => {
		expect(
			storedRuleIssue({
				when: { id: "contributor.recentForkTimes" },
				comparison: { kind: "atMost", args: [1] },
			}),
		).toContain("window count");
	});

	test("a text transform on a non-text signal is rejected", () => {
		expect(
			storedRuleIssue({
				when: {
					id: "contributor.accountAge",
					transform: { kind: "letterCount" },
				},
				comparison: { kind: "atLeast", args: [4] },
			}),
		).toContain("needs a text signal");
	});
});
