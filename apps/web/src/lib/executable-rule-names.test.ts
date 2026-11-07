import { describe, expect, test } from "bun:test";
import { executableRuleNames } from "#/lib/activity.functions";

type Workflow = { nodes: { type: string; ref?: string }[] };

const wf = (nodes: Workflow["nodes"]): Workflow => ({ nodes });
const rule = (ref: string): { type: string; ref: string } => ({
	type: "rule",
	ref,
});

describe("executableRuleNames", () => {
	describe("no saved workflows", () => {
		test("a repo with no rules of any kind yields nothing", () => {
			expect(executableRuleNames([], [], [])).toEqual([]);
		});

		test("enabled standalone custom rule runs (the bug)", () => {
			// A repo whose only enabled rules are standalone custom rules used to
			// return [] because executableRuleNames iterated RULE_CATALOG only.
			// The worker (run-workflows.ts) joins enabled custom rules into the
			// derived toggle set, so they DO evaluate — the preview must agree.
			expect(
				executableRuleNames(
					[],
					[],
					[
						{
							id: "custom-require-linear-history",
							name: "Require linear history",
							enabled: true,
						},
					],
				),
			).toEqual(["Require linear history"]);
		});

		test("disabled standalone custom rule does not run", () => {
			expect(
				executableRuleNames(
					[],
					[],
					[
						{
							id: "custom-require-linear-history",
							name: "Require linear history",
							enabled: false,
						},
					],
				),
			).toEqual([]);
		});

		test("enabled builtin rule still runs (regression)", () => {
			expect(
				executableRuleNames([{ ruleId: "account-age", enabled: true }], [], []),
			).toEqual(["Account age"]);
		});

		test("enabled builtin + enabled custom both run, catalog first", () => {
			expect(
				executableRuleNames(
					[{ ruleId: "account-age", enabled: true }],
					[],
					[
						{
							id: "custom-require-linear-history",
							name: "Require linear history",
							enabled: true,
						},
					],
				),
			).toEqual(["Account age", "Require linear history"]);
		});

		test("disabled builtin + enabled custom yields only the custom rule", () => {
			expect(
				executableRuleNames(
					[{ ruleId: "account-age", enabled: false }],
					[],
					[
						{
							id: "custom-require-linear-history",
							name: "Require linear history",
							enabled: true,
						},
					],
				),
			).toEqual(["Require linear history"]);
		});

		test("multiple custom rules: only enabled ones run", () => {
			expect(
				executableRuleNames(
					[],
					[],
					[
						{ id: "custom-aaa", name: "AAA", enabled: true },
						{ id: "custom-bbb", name: "BBB", enabled: false },
						{ id: "custom-ccc", name: "CCC", enabled: true },
					],
				),
			).toEqual(["AAA", "CCC"]);
		});

		test("custom-rule-only repo with several enabled custom rules", () => {
			expect(
				executableRuleNames(
					[],
					[],
					[
						{ id: "custom-aaa", name: "AAA", enabled: true },
						{ id: "custom-bbb", name: "BBB", enabled: true },
					],
				),
			).toEqual(["AAA", "BBB"]);
		});
	});

	describe("with saved workflows", () => {
		test("workflowed builtin rule runs (existing behavior)", () => {
			expect(executableRuleNames([], [wf([rule("honeypot@1")])], [])).toEqual([
				"Honeypot paths",
			]);
		});

		test("workflowed custom rule shows its stored name, not 'Custom rule'", () => {
			expect(
				executableRuleNames(
					[],
					[wf([rule("custom-require-linear-history@1")])],
					[
						{
							id: "custom-require-linear-history",
							name: "Require linear history",
							enabled: true,
						},
					],
				),
			).toEqual(["Require linear history"]);
		});

		test("standalone custom rule runs alongside a workflowed builtin", () => {
			expect(
				executableRuleNames(
					[],
					[wf([rule("honeypot@1")])],
					[
						{
							id: "custom-require-linear-history",
							name: "Require linear history",
							enabled: true,
						},
					],
				),
			).toEqual(["Honeypot paths", "Require linear history"]);
		});

		test("custom rule owned by a workflow is not duplicated as a leftover", () => {
			expect(
				executableRuleNames(
					[],
					[wf([rule("custom-require-linear-history@1")])],
					[
						{
							id: "custom-require-linear-history",
							name: "Require linear history",
							enabled: true,
						},
					],
				),
			).toEqual(["Require linear history"]);
		});

		test("workflowed custom rule runs even when its standalone toggle is off", () => {
			// The worker runs workflowed rules because they are wired; the
			// standalone enabled toggle governs only derived-default use.
			// The preview must agree so the admin is not told "no rules".
			expect(
				executableRuleNames(
					[],
					[wf([rule("custom-require-linear-history@1")])],
					[
						{
							id: "custom-require-linear-history",
							name: "Require linear history",
							enabled: false,
						},
					],
				),
			).toEqual(["Require linear history"]);
		});

		test("workflowed builtin rule with a disabled config is skipped (kill-switch)", () => {
			expect(
				executableRuleNames(
					[{ ruleId: "honeypot", enabled: false }],
					[wf([rule("honeypot@1")])],
					[],
				),
			).toEqual([]);
		});

		test("non-rule nodes are skipped", () => {
			expect(
				executableRuleNames(
					[],
					[wf([{ type: "trigger" }, { type: "gate" }, rule("honeypot@1")])],
					[],
				),
			).toEqual(["Honeypot paths"]);
		});

		test("the same rule in two workflows is listed once", () => {
			expect(
				executableRuleNames(
					[],
					[wf([rule("honeypot@1")]), wf([rule("honeypot@1")])],
					[],
				),
			).toEqual(["Honeypot paths"]);
		});

		test("mixed: workflowed builtin + standalone enabled custom + disabled extras", () => {
			expect(
				executableRuleNames(
					[{ ruleId: "account-age", enabled: false }],
					[wf([rule("honeypot@1")])],
					[
						{ id: "custom-aaa", name: "AAA", enabled: true },
						{ id: "custom-bbb", name: "BBB", enabled: false },
					],
				),
			).toEqual(["Honeypot paths", "AAA"]);
		});

		test("a custom rule referenced by a workflow but missing from the custom list falls back to the generic name", () => {
			// Dangling ref: the custom rule row is gone but a workflow still
			// references it. ruleDisplayName yields "Custom rule" for custom-*.
			expect(
				executableRuleNames([], [wf([rule("custom-gone@1")])], []),
			).toEqual(["Custom rule"]);
		});
	});
});
