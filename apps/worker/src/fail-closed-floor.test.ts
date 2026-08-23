import { describe, expect, test } from "bun:test";
import { isRunDegraded } from "./jobs/run-workflows.ts";

/**
 * The floor is a RATIO, not "any skip". One flaky read must not stop a human,
 * and a run that is mostly guesswork must not pass.
 */
describe("fail-closed floor", () => {
	test("one skip in four still passes", () => {
		expect(isRunDegraded(4, 1, "pass")).toBe(false);
	});

	test("half the rules skipped does not pass", () => {
		expect(isRunDegraded(4, 2, "pass")).toBe(true);
	});

	test("every rule skipped does not pass", () => {
		expect(isRunDegraded(2, 2, "pass")).toBe(true);
	});

	/**
	 * It only ever escalates a pass. A block stands on its own evidence, so a
	 * degraded run that found a real problem still blocks.
	 */
	test("a block is never softened into review", () => {
		expect(isRunDegraded(2, 2, "block")).toBe(false);
	});

	test("a review verdict is left alone", () => {
		expect(isRunDegraded(2, 2, "needs_review")).toBe(false);
	});

	test("a workflow with no rules cannot degrade", () => {
		expect(isRunDegraded(0, 0, "pass")).toBe(false);
	});
});
