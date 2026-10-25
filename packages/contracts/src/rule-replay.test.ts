import { describe, expect, test } from "bun:test";
import { type RulePreview, rulePreviewSchema } from "./rule-packs.ts";
import { replayRules, ruleSetLabel, ruleSetNames } from "./rule-replay.ts";

function preview(overrides: Partial<RulePreview> = {}): RulePreview {
	return {
		windowDays: 30,
		changeRequests: 3,
		rules: [
			{ ruleId: "account-age", caught: [512], examples: [] },
			{ ruleId: "crypto-address", caught: [471, 512], examples: [] },
			{ ruleId: "pr-rate-limit", caught: null, examples: [] },
		],
		recent: [
			{ number: 512, title: "Add donation link to README", author: "tkw-dev" },
			{ number: 509, title: "Bump vite to 6.2", author: "renovate-bot" },
			{ number: 471, title: "Add airdrop section", author: "wallet-hub-01" },
		],
		...overrides,
	};
}

describe("replayRules", () => {
	test("marks each change request with the first rule that caught it", () => {
		const replay = replayRules(preview(), ["account-age", "crypto-address"]);
		expect(replay?.rows).toEqual([
			{
				number: 512,
				title: "Add donation link to README",
				author: "tkw-dev",
				verdict: "blocked",
				ruleId: "account-age",
			},
			{
				number: 509,
				title: "Bump vite to 6.2",
				author: "renovate-bot",
				verdict: "passed",
				ruleId: null,
			},
			{
				number: 471,
				title: "Add airdrop section",
				author: "wallet-hub-01",
				verdict: "blocked",
				ruleId: "crypto-address",
			},
		]);
		expect(replay?.blocked).toBe(2);
		expect(replay?.windowDays).toBe(30);
	});

	test("drops rules without a count so a pass is never claimed for them", () => {
		const replay = replayRules(preview(), ["account-age", "pr-rate-limit"]);
		expect(replay?.ruleIds).toEqual(["account-age"]);
		expect(replay?.blocked).toBe(1);
	});

	test("gives nothing when no chosen rule has a count", () => {
		expect(replayRules(preview(), ["pr-rate-limit"])).toBeNull();
		expect(replayRules(preview(), [])).toBeNull();
	});

	test("gives nothing without a preview or a change request list", () => {
		expect(replayRules(null, ["account-age"])).toBeNull();
		expect(replayRules(preview({ recent: [] }), ["account-age"])).toBeNull();
	});

	test("a preview stored before the list existed still parses, empty", () => {
		const parsed = rulePreviewSchema.parse({
			windowDays: 30,
			changeRequests: 4,
			rules: [],
		});
		expect(parsed.recent).toEqual([]);
		expect(replayRules(parsed, ["account-age"])).toBeNull();
	});
});

describe("ruleSetLabel", () => {
	test("names whole packs by the pack", () => {
		expect(
			ruleSetLabel([
				"account-age",
				"pr-rate-limit",
				"english-only",
				"crypto-address",
				"honeypot",
			]),
		).toBe("Spam protection and Crypto scams");
	});

	test("names loose rules by the rule", () => {
		expect(ruleSetNames(["account-age", "crypto-address"])).toEqual([
			"Account age",
			"Crypto address",
		]);
		expect(ruleSetLabel(["account-age", "crypto-address", "honeypot"])).toBe(
			"Crypto scams and Account age",
		);
		expect(ruleSetLabel(["max-files-changed"])).toBe("Bulk changes");
		expect(ruleSetLabel([])).toBe("");
	});
});
