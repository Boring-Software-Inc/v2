import { describe, expect, test } from "bun:test";
import type { CommentReason } from "@tripwire/contracts";
import { firedRulesFor } from "./pr-surface.ts";

const REASONS: CommentReason[] = [
	{
		text: "It adds 2 crypto wallet addresses to DONATE.md.",
		remedy: "revise",
		ruleId: "crypto-address",
	},
	{
		text: "Your account is 2 days old.",
		remedy: "wait",
		ruleId: "account-age",
	},
];

describe("firedRulesFor", () => {
	test("open: every reason as written", () => {
		expect(firedRulesFor(REASONS, 0)).toEqual([
			{
				ruleId: "crypto-address",
				summary: "It adds 2 crypto wallet addresses to DONATE.md.",
			},
			{ ruleId: "account-age", summary: "Your account is 2 days old." },
		]);
	});

	test("file paths hidden: the leaking summary becomes the rule label", () => {
		expect(firedRulesFor(REASONS, 2)[0]?.summary).toBe(
			"this change request contains a cryptocurrency wallet address.",
		);
	});

	test("reasons hidden: rule names only", () => {
		expect(firedRulesFor(REASONS, 5)).toEqual([
			{ ruleId: "crypto-address", summary: "Crypto address" },
			{ ruleId: "account-age", summary: "Account age" },
		]);
	});

	test("rule names hidden: nothing fires in the payload", () => {
		expect(firedRulesFor(REASONS, 6)).toEqual([]);
	});
});
