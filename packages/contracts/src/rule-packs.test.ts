import { describe, expect, test } from "bun:test";
import {
	MOST_USED_MIN_REPOS,
	mostUsedOrder,
	previewCaught,
	RECOMMENDED_RULE_IDS,
	RULE_FALLBACK_ORDER,
	RULE_PACKS,
	type RulePreview,
} from "./rule-packs.ts";
import { RULE_CATALOG } from "./rules.ts";

const catalogIds: string[] = RULE_CATALOG.map((entry) => entry.ruleId);

describe("rule packs", () => {
	test("every pack names catalog rules", () => {
		for (const pack of RULE_PACKS) {
			expect(pack.ruleIds.length).toBeGreaterThan(0);
			for (const id of pack.ruleIds) {
				expect(catalogIds).toContain(id);
			}
		}
	});

	test("exactly one pack is recommended", () => {
		expect(RULE_PACKS.filter((pack) => pack.recommended)).toHaveLength(1);
	});

	test("the fallback order covers the whole catalog once", () => {
		expect([...RULE_FALLBACK_ORDER].sort()).toEqual([...catalogIds].sort());
		for (const id of RECOMMENDED_RULE_IDS) {
			expect(catalogIds).toContain(id);
		}
	});
});

describe("mostUsedOrder", () => {
	const ids = ["max-files-changed", "pr-rate-limit", "honeypot"];

	test("falls back to the recommended order without usage", () => {
		expect(mostUsedOrder(ids, null)).toEqual([
			"pr-rate-limit",
			"honeypot",
			"max-files-changed",
		]);
	});

	test("falls back when too few repos have rules on", () => {
		expect(
			mostUsedOrder(ids, {
				repos: MOST_USED_MIN_REPOS - 1,
				byRule: { "max-files-changed": 9 },
			}),
		).toEqual(["pr-rate-limit", "honeypot", "max-files-changed"]);
	});

	test("ranks by repo count, ties in the recommended order", () => {
		expect(
			mostUsedOrder(ids, {
				repos: MOST_USED_MIN_REPOS,
				byRule: { "max-files-changed": 8, honeypot: 3, "pr-rate-limit": 3 },
			}),
		).toEqual(["max-files-changed", "pr-rate-limit", "honeypot"]);
	});
});

describe("previewCaught", () => {
	const preview: RulePreview = {
		windowDays: 30,
		changeRequests: 10,
		rules: [
			{ ruleId: "english-only", caught: [1, 2], examples: [] },
			{ ruleId: "crypto-address", caught: [2, 3], examples: [] },
			{ ruleId: "account-age", caught: null, examples: [] },
		],
	};

	test("a pack counts each change request once", () => {
		expect(previewCaught(preview, ["english-only", "crypto-address"])).toBe(3);
	});

	test("one rule without a count leaves the pack without one", () => {
		expect(previewCaught(preview, ["english-only", "account-age"])).toBeNull();
		expect(previewCaught(preview, ["honeypot"])).toBeNull();
		expect(previewCaught(null, ["english-only"])).toBeNull();
	});
});
