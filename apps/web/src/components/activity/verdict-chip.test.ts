import { describe, expect, test } from "bun:test";
import { runOutcome } from "#/components/activity/verdict-chip";

describe("runOutcome", () => {
	test("a change request run shows its verdict", () => {
		expect(runOutcome("change-request.updated", "pass")).toEqual({
			status: "ok",
			label: "Passed",
		});
		expect(runOutcome("change-request.opened", "block")?.label).toBe("Blocked");
	});

	test("a comment or scheduled run never shows a verdict", () => {
		for (const kind of ["comment.created", "schedule.matched"] as const) {
			expect(runOutcome(kind, "pass")).toEqual({
				status: "idle",
				label: "Ran",
			});
			expect(runOutcome(kind, "block")).toEqual({
				status: "idle",
				label: "Ran",
			});
		}
	});

	test("a run waiting on a person says so, whatever its trigger", () => {
		expect(runOutcome("comment.created", "needs_review")?.status).toBe(
			"waiting",
		);
	});

	test("no verdict yet shows nothing", () => {
		expect(runOutcome("comment.created", null)).toBeUndefined();
	});
});
