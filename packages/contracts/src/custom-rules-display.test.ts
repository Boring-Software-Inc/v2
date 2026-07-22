import { describe, expect, test } from "bun:test";
import {
	CUSTOM_COMPARISON_KINDS,
	type CustomRuleDefinition,
} from "./custom-rules.ts";
import {
	CUSTOM_SIGNALS,
	customRuleSentence,
	customRuleSummary,
	VERBS_BY_KIND,
} from "./custom-rules-display.ts";

const accountAge: CustomRuleDefinition = {
	when: { id: "contributor.accountAge" },
	comparison: { kind: "under", args: [7] },
	severity: "medium",
};

const forkRate: CustomRuleDefinition = {
	when: {
		id: "contributor.recentForkTimes",
		transform: { kind: "lastCount", window: "24h" },
	},
	comparison: { kind: "atMost", args: [20] },
	severity: "high",
};

describe("the maintainer sentence", () => {
	test("reads as plain language with the configured value", () => {
		expect(customRuleSentence(accountAge)).toBe(
			"flag when account age is under 7 days, as a medium signal",
		);
		expect(customRuleSentence(forkRate)).toBe(
			"flag when fork rate in the last 24 hours is at most 20, as a high signal",
		);
	});
});

describe("the public summary (§10)", () => {
	test("carries the observed value and NEVER the configured threshold", () => {
		const summary = customRuleSummary(accountAge, 3);
		expect(summary).toBe("account age is 3 days");
		expect(summary).not.toContain("7");
		const windowed = customRuleSummary(forkRate, 42);
		expect(windowed).toBe("fork rate in the last 24 hours is 42");
		expect(windowed).not.toContain("20");
	});

	test("boolean and path signals summarize without config", () => {
		expect(
			customRuleSummary(
				{
					when: { id: "repoRelation.isOrgMember" },
					comparison: { kind: "equals", args: [true] },
					severity: "low",
				},
				false,
			),
		).toBe("org member: no");
		expect(
			customRuleSummary(
				{
					when: { id: "pr.changedPaths" },
					comparison: { kind: "noneMatch", args: [[".github/**"]] },
					severity: "high",
				},
				["a.ts", "b.ts"],
			),
		).toBe("this change touches 2 paths");
	});
});

describe("the picker offers only safe, type-valid verbs", () => {
	test("every verb in every kind menu is in the v1 safe set", () => {
		const safe = new Set<string>(CUSTOM_COMPARISON_KINDS);
		for (const verbs of Object.values(VERBS_BY_KIND)) {
			for (const verb of verbs) {
				expect(safe.has(verb.kind)).toBe(true);
			}
		}
	});

	test("no menu offers a regex verb", () => {
		for (const verbs of Object.values(VERBS_BY_KIND)) {
			expect(verbs.some((v) => v.kind === "matches" || v.kind === "scan")).toBe(
				false,
			);
		}
	});

	test("numeric verbs never appear on text menus and vice versa", () => {
		const textKinds = VERBS_BY_KIND.text.map((v) => v.kind);
		expect(textKinds).not.toContain("under");
		expect(textKinds).not.toContain("between");
		const numberKinds = VERBS_BY_KIND.number.map((v) => v.kind);
		expect(numberKinds).not.toContain("has");
	});

	test("every picker signal has a verb menu for its kind", () => {
		for (const signal of CUSTOM_SIGNALS) {
			expect(VERBS_BY_KIND[signal.kind].length).toBeGreaterThan(0);
		}
	});
});
