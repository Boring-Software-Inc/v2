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
					severity: "medium",
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
		expect(reasons[0]?.text).toBe("fork rate in the last 24 hours is 87");
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
		// no record + no observed ⇒ the bare-id fallback, but only as a last resort
		expect(reasons[0]?.text).toBe("custom-mystery failed");
	});
});
