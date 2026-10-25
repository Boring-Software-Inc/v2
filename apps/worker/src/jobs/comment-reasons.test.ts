import { describe, expect, test } from "bun:test";
import { buildCommentReasons } from "./comment-reasons.ts";
import { customRuleSource } from "./custom-rules.ts";

/**
 * A failed custom rule speaks its evidence one-liner in the comment, the same
 * slot a built-in's summarize() fills — never the bare generated ref, never the
 * configured threshold (§10: observed value only).
 */
describe("buildCommentReasons — custom rules", () => {
	const records = customRuleSource(
		[
			{
				id: "custom-spam-forks-019f8c",
				name: "spam forks",
				enabled: true,
				definition: {
					when: {
						id: "contributor.recentForkTimes",
						transform: { kind: "lastCount", window: "24h" },
					},
					comparison: { kind: "atMost", args: [50] },
				},
			},
		],
		null,
	).records;

	test("speaks the observed one-liner, not the bare ref or the threshold", () => {
		const reasons = buildCommentReasons(
			[
				{
					nodeKind: "rule",
					status: "fail",
					output: {
						ruleId: "custom-spam-forks-019f8c",
						version: 1,
						evidence: { observed: 87 },
					},
				},
			],
			records,
		);
		expect(reasons[0]?.text).toBe("Fork rate in the last 24 hours is 87.");
		expect(reasons[0]?.ruleName).toBe("spam forks");
		expect(reasons[0]?.text).not.toContain("custom-spam-forks");
		expect(reasons[0]?.text).not.toContain("50"); // the threshold never leaks
	});

	test("without the record it still names the rule, never a raw ref crash", () => {
		const reasons = buildCommentReasons([
			{
				nodeKind: "rule",
				status: "fail",
				output: { ruleId: "custom-mystery", version: 1, evidence: null },
			},
		]);
		expect(reasons[0]?.text).toBe("It does not meet this rule.");
		expect(reasons[0]?.ruleName).toBe("Custom rule");
		expect(JSON.stringify(reasons)).not.toContain('"custom-mystery"}');
	});
});

describe("buildCommentReasons — names and next steps", () => {
	test("built-in rules carry their display name and a fix hint", () => {
		const reasons = buildCommentReasons([
			{
				nodeKind: "rule",
				status: "fail",
				output: {
					ruleId: "crypto-address",
					version: 1,
					evidence: {
						matches: [
							{ kind: "ethereum", value: "0xabc", location: "DONATE.md" },
							{ kind: "bitcoin", value: "bc1abc", location: "DONATE.md" },
						],
					},
				},
			},
			{
				nodeKind: "rule",
				status: "fail",
				output: {
					ruleId: "account-age",
					version: 1,
					evidence: { accountAgeDays: 2, minDays: 7 },
				},
			},
		]);
		expect(reasons).toEqual([
			{
				text: "It adds 2 crypto wallet addresses to DONATE.md.",
				remedy: "revise",
				hint: "Remove the addresses.",
				ruleId: "crypto-address",
				ruleName: "Crypto address",
			},
			{
				text: "Your account is 2 days old.",
				remedy: "wait",
				hint: "This clears in 5 days.",
				ruleId: "account-age",
				ruleName: "Account age",
			},
		]);
	});
});
