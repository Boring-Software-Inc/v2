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

	test("startsWith and endsWith apply to text only and take a string", () => {
		expect(
			storedRuleIssue({
				when: { id: "pr.sourceBranch" },
				comparison: { kind: "startsWith", args: ["release-please"] },
			}),
		).toBeNull();
		expect(
			storedRuleIssue({
				when: { id: "pr.title" },
				comparison: {
					kind: "not",
					args: [{ kind: "endsWith", args: ["."] }],
				},
			}),
		).toBeNull();
		expect(
			storedRuleIssue({
				when: { id: "contributor.accountAge" },
				comparison: { kind: "startsWith", args: ["1"] },
			}),
		).toContain("does not apply");
		expect(
			storedRuleIssue({
				when: { id: "pr.changedPaths" },
				comparison: { kind: "endsWith", args: [".md"] },
			}),
		).toContain("does not apply");
		expect(
			storedRuleIssue({
				when: { id: "pr.sourceBranch" },
				comparison: { kind: "startsWith", args: [7] },
			}),
		).not.toBeNull();
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

	test("arg types are validated against the signal kind, rejected not coerced", () => {
		// A string where a number belongs is rejected on the write path, not left
		// to throw at evaluation.
		expect(
			storedRuleIssue({
				when: { id: "contributor.accountAge" },
				comparison: { kind: "under", args: ["7"] },
			}),
		).toContain("takes a number");
		// A text arg on a numeric verb.
		expect(
			storedRuleIssue({
				when: { id: "contributor.accountAge" },
				comparison: { kind: "between", args: [1, "9"] },
			}),
		).toContain("low and a high number");
		// A number where text belongs.
		expect(
			storedRuleIssue({
				when: { id: "pr.title" },
				comparison: { kind: "equals", args: [5] },
			}),
		).toContain("takes text");
		// An on/off signal takes a boolean.
		expect(
			storedRuleIssue({
				when: { id: "contributor.hireable" },
				comparison: { kind: "equals", args: ["yes"] },
			}),
		).toContain("yes or no");
		// A list verb needs a non-empty list of the right element type.
		expect(
			storedRuleIssue({
				when: { id: "pr.referencedIssueNumbers" },
				comparison: { kind: "anyIn", args: [[]] },
			}),
		).toContain("at least one value");
		expect(
			storedRuleIssue({
				when: { id: "pr.body" },
				comparison: { kind: "containsAny", args: [[7]] },
			}),
		).toContain("must be text");
		// Well-typed args still pass.
		expect(
			storedRuleIssue({
				when: { id: "contributor.accountAge" },
				comparison: { kind: "under", args: [7] },
			}),
		).toBeNull();
		expect(
			storedRuleIssue({
				when: { id: "pr.body" },
				comparison: { kind: "containsAny", args: [["airdrop", "click here"]] },
			}),
		).toBeNull();
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
