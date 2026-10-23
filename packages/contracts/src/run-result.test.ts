import { describe, expect, test } from "bun:test";
import {
	COMMENT_MARKER,
	renderClosedBeforeReviewComment,
} from "./comment-render.ts";
import {
	RUN_RESULT_LABELS,
	RUN_STATUSES,
	runResult,
	runResultLabel,
} from "./run-result.ts";
import { DEFAULT_WORKFLOW, workflowDisplayName } from "./workflow.ts";

describe("a run's result", () => {
	test("a verdict run reads its verdict", () => {
		expect(
			runResult({ status: "completed", verdict: "pass", bearsVerdict: true }),
		).toBe("pass");
		expect(
			runResult({ status: "completed", verdict: "block", bearsVerdict: true }),
		).toBe("block");
		expect(
			runResult({
				status: "paused",
				verdict: "needs_review",
				bearsVerdict: true,
			}),
		).toBe("needs_review");
	});

	test("a run whose change request closed while it waited reads closed before review", () => {
		expect(
			runResult({
				status: "closed",
				verdict: "needs_review",
				bearsVerdict: true,
			}),
		).toBe("closed-before-review");
		expect(runResultLabel("closed-before-review")).toBe("Closed before review");
		expect(RUN_STATUSES).toContain("closed");
	});

	test("a comment or scheduled run that finished reads Ran, whatever its verdict", () => {
		for (const verdict of ["pass", "block"]) {
			expect(
				runResult({ status: "completed", verdict, bearsVerdict: false }),
			).toBe("ran");
		}
		expect(RUN_RESULT_LABELS.ran).toBe("Ran");
	});

	test("a comment run that waits on a human still reads waiting", () => {
		expect(
			runResult({
				status: "paused",
				verdict: "needs_review",
				bearsVerdict: false,
			}),
		).toBe("needs_review");
	});

	test("a run in flight or one that never finished says so", () => {
		expect(
			runResult({ status: "running", verdict: null, bearsVerdict: true }),
		).toBe("checking");
		expect(
			runResult({ status: "queued", verdict: null, bearsVerdict: false }),
		).toBe("checking");
		expect(
			runResult({ status: "failed", verdict: null, bearsVerdict: true }),
		).toBe("did-not-finish");
		expect(
			runResult({ status: "completed", verdict: null, bearsVerdict: true }),
		).toBeNull();
	});

	test("the labels match the run page", () => {
		expect(RUN_RESULT_LABELS).toEqual({
			checking: "Checking",
			"did-not-finish": "Did not finish",
			pass: "Passed",
			block: "Blocked",
			needs_review: "Waiting for human review",
			"closed-before-review": "Closed before review",
			ran: "Ran",
		});
	});
});

describe("workflow names", () => {
	test("the default workflow reads Rules everywhere", () => {
		expect(workflowDisplayName(DEFAULT_WORKFLOW)).toBe("Rules");
		expect(workflowDisplayName({ id: "x", name: "Newcomers" })).toBe(
			"Newcomers",
		);
	});
});

describe("the comment on a change request closed before review", () => {
	test("says so in one line and keeps the marker", () => {
		expect(renderClosedBeforeReviewComment()).toBe(
			`Closed before review.\n\n${COMMENT_MARKER}\n`,
		);
	});
});
