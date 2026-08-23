import { describe, expect, test } from "bun:test";
import {
	CUSTOM_COMPARISON_KINDS,
	type CustomRuleDefinition,
} from "./custom-rules.ts";
import {
	CUSTOM_SIGNALS,
	customRuleSentence,
	customRuleSummary,
	customSignalDisplay,
	VERBS_BY_KIND,
	valuePlaceholder,
	verbsForSignal,
} from "./custom-rules-display.ts";

function display(id: string) {
	const found = customSignalDisplay(id);
	if (!found) {
		throw new Error(`no display for ${id}`);
	}
	return found;
}

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

describe("verb narrowing by meaning", () => {
	test("enum-ish text signals offer is / is not / is one of, not substring", () => {
		const verbs = verbsForSignal(display("pr.targetBranch")).map((v) => v.kind);
		expect(verbs).toEqual(["equals", "noneOf", "oneOf"]);
		expect(verbs).not.toContain("has");
		expect(verbs).not.toContain("containsAny");
	});

	test("free-text signals keep the substring verbs", () => {
		const verbs = verbsForSignal(display("pr.body")).map((v) => v.kind);
		expect(verbs).toContain("has");
		expect(verbs).toContain("containsAny");
	});

	test("the sentence uses the narrowed label for an enum signal", () => {
		expect(
			customRuleSentence({
				when: { id: "pr.targetBranch" },
				comparison: { kind: "oneOf", args: [["Next"]] },
				severity: "medium",
			}),
		).toBe("require that target branch is one of Next");
	});

	test("a negating verb reads naturally under 'require that' (enum → 'is not')", () => {
		// The double-negation that made these rules accidentally correct now also
		// reads correctly: passed = target ∉ {staging} = block staging PRs.
		expect(
			customRuleSentence({
				when: { id: "pr.targetBranch" },
				comparison: { kind: "noneOf", args: [["staging"]] },
				severity: "high",
			}),
		).toBe("require that target branch is not staging");
	});
});

describe("typed value placeholders", () => {
	test("names what the field wants by kind, unit, and source", () => {
		expect(valuePlaceholder(display("contributor.accountAge"), "under")).toBe(
			"number of days",
		);
		expect(
			valuePlaceholder(display("contributor.mergeRatioGlobal"), "under"),
		).toBe("0 to 100");
		expect(valuePlaceholder(display("pr.filesChanged"), "between")).toBe(
			"low to high",
		);
		expect(valuePlaceholder(display("pr.targetBranch"), "equals")).toBe(
			"branch name",
		);
		expect(valuePlaceholder(display("contributor.login"), "equals")).toBe(
			"username",
		);
		expect(valuePlaceholder(display("pr.body"), "containsAny")).toBe("a term");
	});
});

describe("the maintainer sentence", () => {
	test("reads as plain language with the configured value", () => {
		expect(customRuleSentence(accountAge)).toBe(
			"require that account age is under 7 days",
		);
		expect(customRuleSentence(forkRate)).toBe(
			"require that fork rate in the last 24 hours is at most 20",
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
