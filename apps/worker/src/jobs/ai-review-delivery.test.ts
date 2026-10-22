import { describe, expect, test } from "bun:test";
import type { AiReviewOutput } from "@tripwire/contracts";
import { checkSummary, renderCommentBody } from "@tripwire/forge-github";
import { buildCommentReasons } from "./comment-reasons.ts";
import { VERDICT_TO_CONCLUSION } from "./pr-surface.ts";

/**
 * Layer 4 (dev lane) — the review must actually LAND. Right judgment with a
 * broken surface is still a broken product. This drives the real delivery
 * assembly (buildCommentReasons ⇒ renderCommentBody + checkSummary + the
 * verdict→conclusion map) with canned verdicts, no model and no network, and
 * pins where ai-review output appears and that the surfaces agree.
 */

const AI_SUMMARY = "Hardcoded credential exfiltration to an external host.";

function aiStep(status: "fail" | "skipped", output?: AiReviewOutput) {
	return {
		nodeKind: "rule",
		status,
		output: {
			ruleId: "ai-review",
			version: 2,
			evidence: output
				? {
						output,
						trace: {
							model: "m",
							stepsUsed: 2,
							maxSteps: 12,
							trimmed: false,
							usage: { input: 1, output: 1, cached: null },
							steps: [],
						},
					}
				: null,
		},
	};
}

const blockOutput: AiReviewOutput = {
	verdict: "block",
	confidence: 0.95,
	summary: AI_SUMMARY,
	findings: [
		{
			severity: "critical",
			file: "src/analytics.ts",
			note: "sends `AWS_SECRET` off-box",
		},
	],
};

const body = (
	verdict: "block" | "pass" | "needs_review",
	reasons: ReturnType<typeof buildCommentReasons>,
) =>
	renderCommentBody({
		verdict,
		contributorLogin: "stranger",
		reasons,
		runUrl: "https://tripwire.sh/runs/1",
		previousVerdict: null,
	});

describe("ai-review delivery — where the output lands and surfaces agree", () => {
	test("a blocking ai-review summary reaches the comment AND the check summary", () => {
		const reasons = buildCommentReasons([aiStep("fail", blockOutput)]);
		expect(reasons[0]?.text).toBe(AI_SUMMARY); // output.summary → reason
		expect(body("block", reasons)).toContain(`**AI review:** ${AI_SUMMARY}`);
		expect(checkSummary("block", reasons)).toBe("Blocked by AI review.");
	});

	test("check conclusion matches the verdict (comment and check can't disagree)", () => {
		expect(VERDICT_TO_CONCLUSION.block).toBe("failure");
		expect(VERDICT_TO_CONCLUSION.pass).toBe("success");
		expect(VERDICT_TO_CONCLUSION.needs_review).toBe("pending");
	});

	test("a SKIPPED ai-review claims no review happened", () => {
		const reasons = buildCommentReasons([aiStep("skipped")]);
		expect(reasons).toEqual([]); // skipped contributes no reason
		expect(body("pass", reasons)).not.toContain(AI_SUMMARY);
		expect(body("pass", reasons)).not.toContain("reviewed");
	});

	test("needs_review produces the moderation surface, not a silent pass", () => {
		const summary = checkSummary("needs_review", []);
		expect(summary).toBe("Waiting for human review.");
		expect(VERDICT_TO_CONCLUSION.needs_review).not.toBe("success");
	});
});
