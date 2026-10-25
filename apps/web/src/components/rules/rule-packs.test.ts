import { describe, expect, test } from "bun:test";
import type { RuleConfigView } from "#/lib/rules.functions";
import { replayRuleIds } from "./rule-packs";

const rule = (over: Partial<RuleConfigView>): RuleConfigView => ({
	ruleId: "account-age",
	forgeBlockReason: null,
	unavailableReason: null,
	version: 1,
	held: false,
	changeNote: null,
	name: "Account age",
	blurb: "the contributor's account must be old enough.",
	enabled: false,
	config: { minDays: 7 },
	defaultConfig: { minDays: 7 },
	management: "standalone",
	workflowId: null,
	optIn: false,
	matches24h: 0,
	trend: [],
	source: "built-in",
	sentence: null,
	blockingWorkflows: [],
	outcome: { outcome: "block", instruction: "" },
	owners: [],
	...over,
});

describe("replayRuleIds", () => {
	test("replays the built-in rules that are on", () => {
		expect(
			replayRuleIds([
				rule({ ruleId: "account-age", enabled: true }),
				rule({
					ruleId: "honeypot",
					enabled: false,
					config: {},
					defaultConfig: {},
				}),
				rule({ ruleId: "custom-x", enabled: true, source: "custom" }),
			]),
		).toEqual(["account-age"]);
	});

	test("with nothing on it replays the recommended pack", () => {
		expect(replayRuleIds([])).toEqual([
			"account-age",
			"pr-rate-limit",
			"english-only",
		]);
	});

	test("a rule tuned away from its defaults is left out", () => {
		expect(
			replayRuleIds([
				rule({ ruleId: "account-age", enabled: true, config: { minDays: 30 } }),
				rule({
					ruleId: "english-only",
					enabled: true,
					config: { maxNonLatinRatio: 0.5 },
					defaultConfig: { maxNonLatinRatio: 0.5 },
				}),
			]),
		).toEqual(["english-only"]);
		expect(
			replayRuleIds([rule({ ruleId: "account-age", config: { minDays: 30 } })]),
		).toEqual(["pr-rate-limit", "english-only"]);
	});
});
