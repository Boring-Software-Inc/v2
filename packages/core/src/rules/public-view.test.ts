import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import {
	listRules,
	PUBLIC_VIEW_OPT_OUT,
	projectRulePublic,
} from "./registry.ts";

/**
 * §10 public partition — the LEAK INVARIANT. A rule's public evidence must
 * never carry a configured-threshold field: those are the maintainer's tuning
 * (repo internals), not the contributor's facts. Driven over the whole
 * registry so a FUTURE rule can't leak its threshold just by existing.
 */

/** Representative evidence per rule — observed fields AND thresholds present, */
/** so the test proves the thresholds are dropped, not merely absent. */
const SAMPLE_EVIDENCE: Record<string, Record<string, unknown>> = {
	"account-age": { accountAgeDays: 2038, minDays: 7 },
	// @2 evidence — observed counts AND both thresholds, so the leak guard proves
	// `min` and `trustedAfter` are dropped, not merely absent.
	"min-merged-prs": {
		mergedElsewhere: 2,
		mergedInRepo: 3,
		min: 5,
		trustedAfter: 3,
	},
	"pr-rate-limit": {
		count: 2,
		maxPerWindow: 1,
		windowHours: 24,
		intervalCov: null,
	},
	"max-files-changed": { filesChanged: 2, max: 200 },
	"english-only": { ratio: 0.5, lettersExamined: 10, sample: "修复: fix" },
	"crypto-address": {
		matches: [{ kind: "eth", value: "0xAb58", location: "DONATE.md" }],
	},
	honeypot: { touched: [".github/workflows/exfil.yml"] },
	"profile-readme": { hasProfileText: true, length: 24, minLength: 32 },
	"ai-review": {
		output: { verdict: "block", confidence: 1, summary: "slop.", findings: [] },
		trace: { steps: 4, tokens: 9000, model: "x" },
	},
};

/** Evidence that TRIGGERS a wait-rule's hint (a positive remainder), so the */
/** leak guard checks a real string, not a vacuous null. */
const WAIT_SAMPLE: Record<string, Record<string, unknown>> = {
	"account-age": { accountAgeDays: 2, minDays: 7 },
};

function configKeys(schema: z.ZodType): string[] {
	const shape = (schema as unknown as { shape?: Record<string, unknown> })
		.shape;
	return shape ? Object.keys(shape) : [];
}

describe("§10 public partition", () => {
	test("every registry rule defines both members or opts out with a reason", () => {
		for (const { rule } of listRules()) {
			const hasBoth = Boolean(rule.publicEvidence && rule.summarize);
			const optedOut = rule.id in PUBLIC_VIEW_OPT_OUT;
			if (!(hasBoth || optedOut)) {
				throw new Error(
					`rule ${rule.id} defines neither a public partition nor an opt-out reason`,
				);
			}
			if (optedOut) {
				expect(PUBLIC_VIEW_OPT_OUT[rule.id]?.length ?? 0).toBeGreaterThan(0);
			}
		}
	});

	test("LEAK INVARIANT: no configured-threshold field appears in public evidence", () => {
		for (const { ref, rule } of listRules()) {
			if (rule.id in PUBLIC_VIEW_OPT_OUT) {
				continue;
			}
			const sample = SAMPLE_EVIDENCE[rule.id];
			if (!sample) {
				throw new Error(`no SAMPLE_EVIDENCE for ${rule.id} — add one`);
			}
			const { publicEvidence } = projectRulePublic(ref, sample, false);
			const serialized = JSON.stringify(publicEvidence);
			for (const key of configKeys(rule.configSchema)) {
				expect(serialized).not.toContain(`"${key}"`);
			}
		}
	});

	test("LEAK INVARIANT: a waitHint never names a configured-threshold field", () => {
		for (const { rule } of listRules()) {
			if (!rule.waitHint) {
				continue;
			}
			const sample = WAIT_SAMPLE[rule.id] ?? SAMPLE_EVIDENCE[rule.id];
			// The hint must be derivable (a real remainder), else the guard is vacuous.
			const hint = rule.waitHint(sample) ?? "";
			for (const key of configKeys(rule.configSchema)) {
				expect(hint).not.toContain(key);
			}
		}
	});

	test("LEAK INVARIANT: a fixHint never names a configured-threshold field", () => {
		for (const { rule } of listRules()) {
			if (!rule.fixHint) {
				continue;
			}
			const hint = rule.fixHint(SAMPLE_EVIDENCE[rule.id]) ?? "";
			expect(hint).not.toBe("");
			for (const key of configKeys(rule.configSchema)) {
				expect(hint).not.toContain(key);
			}
		}
	});

	test("rate limit hints only when the contributor is over the limit", () => {
		const { rule } =
			listRules().find((r) => r.rule.id === "pr-rate-limit") ?? {};
		const over = {
			count: 12,
			maxPerWindow: 5,
			windowHours: 24,
			intervalCov: null,
		};
		const under = { ...over, count: 2 };
		expect(rule?.summarize?.(over, false)).toBe(
			"You opened 12 change requests in a short time.",
		);
		expect(rule?.waitHint?.(over)).toBe("Wait before you open another.");
		expect(rule?.summarize?.(under, true)).toBe(
			"You opened 2 change requests recently.",
		);
		expect(rule?.waitHint?.(under)).toBeNull();
	});

	test("min-merged-prs waitHint says what to do, never the threshold", () => {
		const { rule } =
			listRules().find(
				(r) => r.rule.id === "min-merged-prs" && r.rule.version === 2,
			) ?? {};
		expect(
			rule?.waitHint?.({
				mergedElsewhere: 0,
				min: 1,
				mergedInRepo: 0,
				trustedAfter: 1,
			}),
		).toBe(
			"To clear this, get 1 more change request merged in someone else's repository.",
		);
		expect(
			rule?.waitHint?.({
				mergedElsewhere: 0,
				min: 3,
				mergedInRepo: 0,
				trustedAfter: 1,
			}),
		).toBe(
			"To clear this, get 3 more change requests merged in other people's repositories.",
		);
	});

	test("account-age waitHint derives a threshold-free remainder", () => {
		const { rule } = listRules().find((r) => r.rule.id === "account-age") ?? {};
		expect(rule?.remedy).toBe("wait");
		expect(rule?.waitHint?.({ accountAgeDays: 2, minDays: 7 })).toBe(
			"This clears in 5 days.",
		);
		// A contributor already over the bar has nothing to wait for.
		expect(rule?.waitHint?.({ accountAgeDays: 30, minDays: 7 })).toBeNull();
	});

	test("ai-review keeps findings/summary but drops the raw trace", () => {
		const { publicEvidence, summary } = projectRulePublic(
			"ai-review@1",
			SAMPLE_EVIDENCE["ai-review"],
			false,
		);
		const serialized = JSON.stringify(publicEvidence);
		expect(serialized).toContain("findings");
		expect(serialized).not.toContain("trace");
		expect(summary).toBe("slop.");
	});

	test("observed values survive; one-liners read in constitution voice", () => {
		const age = projectRulePublic(
			"account-age@1",
			SAMPLE_EVIDENCE["account-age"],
			true,
		);
		expect(age.publicEvidence).toEqual({ accountAgeDays: 2038 });
		expect(age.summary).toBe("Your account is 2038 days old.");

		const crypto = projectRulePublic(
			"crypto-address@1",
			SAMPLE_EVIDENCE["crypto-address"],
			false,
		);
		expect(crypto.summary).toBe(
			"It adds 1 crypto wallet address to DONATE.md.",
		);
	});

	test("a passing rule never projects a sentence that says it failed", () => {
		const english = projectRulePublic(
			"english-only@1",
			{ ratio: 0, lettersExamined: 15, sample: "Add donate links" },
			true,
		);
		expect(english.summary).toBeNull();
		const readme = projectRulePublic(
			"profile-readme@1",
			{ hasProfileText: true, length: 80, minLength: 32 },
			true,
		);
		expect(readme.summary).toBeNull();
		expect(
			projectRulePublic(
				"english-only@1",
				SAMPLE_EVIDENCE["english-only"],
				false,
			).summary,
		).toBe("Most of the title is not written in the Latin alphabet.");
		expect(
			projectRulePublic(
				"profile-readme@1",
				SAMPLE_EVIDENCE["profile-readme"],
				false,
			).summary,
		).toBe("Your GitHub profile README is too short.");
	});

	test("skipped evidence (null) projects to nothing — safe by default", () => {
		expect(projectRulePublic("account-age@1", null, false)).toEqual({
			publicEvidence: null,
			summary: null,
		});
	});
});
