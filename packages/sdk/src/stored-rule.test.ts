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

	test("containsAny applies to text, anyIn to lists, and neither crosses kinds", () => {
		expect(
			storedRuleIssue({
				when: { id: "pr.body" },
				comparison: { kind: "containsAny", args: [["strawberry"]] },
			}),
		).toBeNull();
		expect(
			storedRuleIssue({
				when: { id: "pr.referencedIssueNumbers" },
				comparison: { kind: "anyIn", args: [["8154"]] },
			}),
		).toBeNull();
		// containsAny is text-only; a list signal must not accept it.
		expect(
			storedRuleIssue({
				when: { id: "pr.referencedIssueNumbers" },
				comparison: { kind: "containsAny", args: [["8154"]] },
			}),
		).toContain("does not apply");
		// anyIn is list-only; a text signal must not accept it.
		expect(
			storedRuleIssue({
				when: { id: "pr.body" },
				comparison: { kind: "anyIn", args: [["x"]] },
			}),
		).toContain("does not apply");
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
