import { describe, expect, test } from "bun:test";
import { RULE_CATALOG, resolveEffectiveRuleConfig } from "./rules.ts";

const minMerged = RULE_CATALOG.find((r) => r.ruleId === "min-merged-prs");
if (!minMerged) {
	throw new Error("fixture: min-merged-prs catalog entry missing");
}
// A rule that has never bumped (still @1) — the "already current" baseline.
const accountAge = RULE_CATALOG.find((r) => r.ruleId === "account-age");
if (!accountAge) {
	throw new Error("fixture: account-age catalog entry missing");
}
// A rule that bumped but whose config schema is identical across versions —
// v1 configs carry forward losslessly (no carriesForward gate needed).
const aiReview = RULE_CATALOG.find((r) => r.ruleId === "ai-review");
if (!aiReview) {
	throw new Error("fixture: ai-review catalog entry missing");
}

/**
 * §6 (b) upgrade policy — auto-advance when lossless, hold when the config can't
 * carry forward. This is the DB-free heart of the mechanism, used identically by
 * the worker (evaluation) and the web (the held indicator).
 */
describe("resolveEffectiveRuleConfig", () => {
	test("already at current ⇒ runs as pinned, not held", () => {
		const r = resolveEffectiveRuleConfig({
			ruleId: "min-merged-prs",
			version: minMerged.version,
			enabled: true,
			config: minMerged.defaultConfig,
		});
		expect(r).toEqual({
			ref: `min-merged-prs@${minMerged.version}`,
			enabled: true,
			config: minMerged.defaultConfig,
			held: false,
		});
	});

	test("pinned behind + v2-shaped config (has trustedAfter) ⇒ AUTO-ADVANCE to current, not held", () => {
		const config = { min: 3, trustedAfter: 2 };
		const r = resolveEffectiveRuleConfig({
			ruleId: "min-merged-prs",
			version: 1,
			enabled: true,
			config,
		});
		expect(r).toEqual({
			ref: `min-merged-prs@${minMerged.version}`,
			enabled: true,
			config,
			held: false,
		});
	});

	test("pinned behind + v1-shaped config ({min} only, no trustedAfter) ⇒ HELD, not silently auto-advanced", () => {
		// This is the realistic legacy population: a v1-authored config
		// {min: N} parses under the v2 schema (trustedAfter defaults to 1),
		// but carrying it forward would silently re-interpret `min` on a
		// different signal and auto-create an exemption the maintainer never
		// set. The hold guard must fire so the maintainer re-confirms.
		const config = { min: 5 };
		const r = resolveEffectiveRuleConfig({
			ruleId: "min-merged-prs",
			version: 1,
			enabled: true,
			config,
		});
		expect(r).toEqual({
			ref: "min-merged-prs@1",
			enabled: true,
			config,
			held: true,
		});
	});

	test("pinned behind + empty v1-shaped config ({}) ⇒ HELD (defaults would silently fill new fields)", () => {
		const r = resolveEffectiveRuleConfig({
			ruleId: "min-merged-prs",
			version: 1,
			enabled: true,
			config: {},
		});
		expect(r).toEqual({
			ref: "min-merged-prs@1",
			enabled: true,
			config: {},
			held: true,
		});
	});

	test("pinned behind + config CANNOT parse under the new schema ⇒ HELD on the pinned version", () => {
		const r = resolveEffectiveRuleConfig({
			ruleId: "min-merged-prs",
			version: 1,
			enabled: true,
			config: null,
		});
		expect(r).toEqual({
			ref: "min-merged-prs@1",
			enabled: true,
			config: null,
			held: true,
		});
	});

	test("never-bumped rule ⇒ runs as pinned, never held", () => {
		const r = resolveEffectiveRuleConfig({
			ruleId: "account-age",
			version: accountAge.version,
			enabled: true,
			config: { minDays: 30 },
		});
		expect(r.held).toBe(false);
		expect(r.ref).toBe(`account-age@${accountAge.version}`);
	});

	test("bumped rule with identical config schema (ai-review) ⇒ v1 config AUTO-ADVANCES, not held", () => {
		// ai-review@2 changed the prompt, not the config schema — a v1
		// config carries forward losslessly with no shape gate needed.
		const config = { maxSteps: 8 };
		const r = resolveEffectiveRuleConfig({
			ruleId: "ai-review",
			version: 1,
			enabled: true,
			config,
		});
		expect(r).toEqual({
			ref: `ai-review@${aiReview.version}`,
			enabled: true,
			config,
			held: false,
		});
	});

	test("unknown rule id ⇒ passthrough, never held", () => {
		const r = resolveEffectiveRuleConfig({
			ruleId: "not-a-rule",
			version: 1,
			enabled: false,
			config: {},
		});
		expect(r).toEqual({
			ref: "not-a-rule@1",
			enabled: false,
			config: {},
			held: false,
		});
	});
});
