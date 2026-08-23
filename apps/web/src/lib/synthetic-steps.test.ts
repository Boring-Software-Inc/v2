import { describe, expect, test } from "bun:test";
import { describeSyntheticStep } from "#/lib/synthetic-steps";

/** VERIFICATION-QUEUE #11 — synthetic steps must read distinctly. */

describe("describeSyntheticStep", () => {
	test("run:deny-floor says a maintainer denied it and why it blocked", () => {
		const view = describeSyntheticStep({
			nodeId: "run:deny-floor",
			output: { rule: "deny (no deny edge) → block by default" },
		});
		expect(view?.kind).toBe("deny-floor");
		expect(view?.title).toBe("denied by maintainer");
		expect(view?.detail).toContain("no deny edge drawn");
	});

	test("run:degradation names the count and what it cost", () => {
		const view = describeSyntheticStep({
			nodeId: "run:degradation",
			output: {
				degradedReads: ["getContributorProfile"],
				skippedRules: 2,
				ruleNodes: 3,
			},
		});
		expect(view?.kind).toBe("degradation");
		expect(view?.title).toBe("some rules couldn't run");
		expect(view?.detail).toContain("2 of 3 skipped");
		expect(view?.detail).toContain("getContributorProfile");
		expect(view?.detail).toContain("sent to review");
		// The old copy argued with the reader and used our own jargon.
		expect(view?.detail).not.toContain("guesswork");
		expect(view?.detail).not.toContain("fail-closed floor");
	});

	test("one skipped rule reads as one", () => {
		const view = describeSyntheticStep({
			nodeId: "run:degradation",
			output: { skippedRules: 1, ruleNodes: 2 },
		});
		expect(view?.title).toBe("a rule couldn't run");
		expect(view?.detail).toBe("1 of 2 skipped. sent to review.");
	});

	test("with the fallback off it says the run passed anyway", () => {
		const view = describeSyntheticStep({
			nodeId: "run:degradation",
			output: { skippedRules: 2, ruleNodes: 3, enforced: false },
		});
		expect(view?.detail).toContain("passed anyway");
		expect(view?.detail).not.toContain("sent to review");
	});

	test("run:degradation stays honest when output is malformed", () => {
		const view = describeSyntheticStep({
			nodeId: "run:degradation",
			output: null,
		});
		// No counts to show, so it says only what happened. Never a stray "skipped."
		expect(view?.detail).toBe("sent to review.");
	});

	test("ordinary graph nodes are not synthetic", () => {
		for (const nodeId of [
			"default@1:account-age-1",
			"default@1:send-to-moderation-1",
			"run:deny-floor:resume",
		]) {
			expect(describeSyntheticStep({ nodeId, output: null })).toBeNull();
		}
	});
});
