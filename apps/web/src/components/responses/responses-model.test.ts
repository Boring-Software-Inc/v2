import { describe, expect, test } from "bun:test";
import {
	DEFAULT_RESPONSE_CONFIG,
	redactionPolicySchema,
	responseConfigSchema,
} from "@tripwire/contracts";
import { previewPlan } from "#/components/responses/responses-model";

const policy = (level: number) => redactionPolicySchema.parse({ level });

describe("the Responses preview shows what lands on the change request", () => {
	test("levels 0 to 4: the review points at the comment", () => {
		const plan = previewPlan(
			DEFAULT_RESPONSE_CONFIG,
			"block",
			false,
			policy(0),
		);
		expect(plan.review).toBe("Blocked. See the comment.");
		expect(plan.comment).toBe("upsert");
		expect(plan.commentBody).toContain("**Account age:**");
		expect(plan.commentBody).toContain('alt="View on Tripwire"');
	});

	test("level 6: one review, no comment", () => {
		const plan = previewPlan(
			DEFAULT_RESPONSE_CONFIG,
			"block",
			false,
			policy(6),
		);
		expect(plan.comment).toBe("delete");
		expect(plan.review).toContain("2 rules did not pass.");
		expect(plan.review).toContain('alt="View on Tripwire"');
	});

	test("human review and pass never preview a review", () => {
		expect(
			previewPlan(DEFAULT_RESPONSE_CONFIG, "needs_review", false, policy(0))
				.review,
		).toBeNull();
		const loud = responseConfigSchema.parse({ onSuccess: "comment" });
		const pass = previewPlan(loud, "pass", false, policy(0));
		expect(pass.review).toBeNull();
		expect(pass.commentBody).toContain("Tripwire passed this change request.");
	});
});
