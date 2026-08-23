import { describe, expect, test } from "bun:test";
import { publicSkipReason } from "./run-workflows.ts";

/**
 * §10 — a skipped step's reason becomes public copy on the run page and the
 * comment. Operational reasons read fine to a contributor; bug-class / internal
 * ones (a thrown rule, a schema mismatch) must never surface a stack trace.
 */
describe("publicSkipReason", () => {
	test("operational reasons pass through verbatim", () => {
		for (const reason of [
			"contributor profile unavailable",
			"no text to examine",
			"not enough letters to judge",
			"forge reads unavailable",
			"fork history unavailable",
			"not a change-request event",
		]) {
			expect(publicSkipReason(reason)).toBe(reason);
		}
	});

	test("bug-class / internal reasons collapse to a generic line", () => {
		const generic = "this rule couldn't be evaluated";
		expect(
			publicSkipReason("rule threw: Cannot read properties of undefined"),
		).toBe(generic);
		expect(publicSkipReason("unknown rule custom-x@1")).toBe(generic);
		expect(publicSkipReason("evidence failed schema: Expected number")).toBe(
			generic,
		);
		expect(publicSkipReason("invalid config: minDays must be >= 0")).toBe(
			generic,
		);
		expect(
			publicSkipReason("review output failed the muzzle schema: too long"),
		).toBe(generic);
	});
});
