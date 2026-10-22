import { describe, expect, test } from "bun:test";
import {
	describeDegradedReads,
	describeSyntheticStep,
} from "#/lib/synthetic-steps";

/** VERIFICATION-QUEUE #11 — synthetic steps must read distinctly. */

describe("describeSyntheticStep", () => {
	test("run:deny-floor says a maintainer denied it and why it blocked", () => {
		const view = describeSyntheticStep({
			nodeId: "run:deny-floor",
			output: { rule: "deny (no deny edge) → block by default" },
		});
		expect(view?.kind).toBe("deny-floor");
		expect(view?.title).toBe("Blocked by a maintainer");
		expect(view?.detail).toContain("no step for that choice");
		expect(view?.detail).toContain("blocked the change request");
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
		expect(view?.title).toBe("Some rules could not run");
		expect(view?.detail).toContain("2 of 3 rules skipped");
		expect(view?.detail).toContain(
			"Tripwire could not read the contributor's profile.",
		);
		expect(view?.detail).not.toContain("getContributorProfile");
		expect(view?.detail).toContain("Needs human review");
		// The old copy argued with the reader and used our own jargon.
		expect(view?.detail).not.toContain("guesswork");
		expect(view?.detail).not.toContain("fail-closed floor");
	});

	test("one skipped rule reads as one", () => {
		const view = describeSyntheticStep({
			nodeId: "run:degradation",
			output: { skippedRules: 1, ruleNodes: 2 },
		});
		expect(view?.title).toBe("A rule could not run");
		expect(view?.detail).toBe("1 of 2 rules skipped. Needs human review.");
	});

	test("with the fallback off it says the run passed anyway", () => {
		const view = describeSyntheticStep({
			nodeId: "run:degradation",
			output: { skippedRules: 2, ruleNodes: 3, enforced: false },
		});
		expect(view?.detail).toContain("Passed without them");
		expect(view?.detail).toContain(
			"passes change requests when a rule cannot run",
		);
		expect(view?.detail).not.toContain("human review");
	});

	test("a scheduled run that could not check its thread took no action", () => {
		const view = describeSyntheticStep({
			nodeId: "run:degradation",
			output: {
				skippedRules: 2,
				ruleNodes: 2,
				enforced: false,
				tookNoAction: true,
			},
		});
		expect(view?.detail).toBe(
			"2 of 2 rules skipped. Tripwire could not check this thread, so it took no action.",
		);
	});

	test("run:degradation stays honest when output is malformed", () => {
		const view = describeSyntheticStep({
			nodeId: "run:degradation",
			output: null,
		});
		// No counts to show, so it says only what happened. Never a stray "skipped."
		expect(view?.detail).toBe("Needs human review.");
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

test("no synthetic copy uses an em dash", () => {
	for (const nodeId of ["run:deny-floor", "run:degradation"]) {
		const view = describeSyntheticStep({
			nodeId,
			output: { skippedRules: 2, ruleNodes: 3, enforced: false },
		});
		expect(view?.title).not.toContain("\u2014");
		expect(view?.detail).not.toContain("\u2014");
	}
});

describe("describeDegradedReads", () => {
	test("every read the worker reports has a plain name", () => {
		expect(describeDegradedReads(["diff"])).toBe(
			"Tripwire could not read the changed files.",
		);
		expect(describeDegradedReads(["commits"])).toBe(
			"Tripwire could not read the commits.",
		);
		expect(describeDegradedReads(["contributor"])).toBe(
			"Tripwire could not read the contributor's profile.",
		);
		expect(describeDegradedReads(["diff", "commits", "contributor"])).toBe(
			"Tripwire could not read the changed files, the commits and the contributor's profile.",
		);
	});

	test("an unknown read falls back to plain words, never the raw id", () => {
		const text = describeDegradedReads(["getMysteryThing", "otherThing"]);
		expect(text).toBe(
			"Tripwire could not read some details of the change request.",
		);
		expect(text).not.toContain("getMysteryThing");
	});
});
