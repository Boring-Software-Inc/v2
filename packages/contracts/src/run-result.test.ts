import { describe, expect, test } from "bun:test";
import {
	COMMENT_MARKER,
	renderClosedBeforeReviewComment,
	runButton,
} from "./comment-render.ts";
import {
	RUN_RESULT_LABELS,
	RUN_STATUSES,
	runResult,
	runResultLabel,
} from "./run-result.ts";
import { DEFAULT_WORKFLOW, workflowDisplayName } from "./workflow.ts";

describe("a backfill run's result (R7-1)", () => {
	test("reads as what Tripwire would have done, since it took no action", () => {
		expect(runResultLabel("pass", { backfill: true })).toBe("Would pass");
		expect(runResultLabel("block", { backfill: true })).toBe("Would block");
		expect(runResultLabel("needs_review", { backfill: true })).toBe(
			"Would go to human review",
		);
	});

	test("a live run keeps its usual words", () => {
		expect(runResultLabel("needs_review", { backfill: false })).toBe(
			"Waiting for human review",
		);
		expect(runResultLabel("ran", { backfill: true })).toBe("Ran");
	});
});

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
	const runUrl = "https://tripwire.sh/runs/r1";

	test("names the contributor and links the run, like the other verdicts", () => {
		expect(
			renderClosedBeforeReviewComment({
				contributorLogin: "octocat",
				runUrl,
				showRunLink: true,
			}),
		).toBe(
			`@octocat, this change request closed before review.\n\n${runButton(runUrl)}\n\n${COMMENT_MARKER}\n`,
		);
	});

	test("leaves the run link out when the repo hides it", () => {
		expect(
			renderClosedBeforeReviewComment({
				contributorLogin: "octocat",
				runUrl,
				showRunLink: false,
			}),
		).toBe(
			`@octocat, this change request closed before review.\n\n${COMMENT_MARKER}\n`,
		);
	});

	test("reads without a mention when the contributor is unknown", () => {
		expect(
			renderClosedBeforeReviewComment({
				contributorLogin: null,
				runUrl,
				showRunLink: false,
			}),
		).toBe(`This change request closed before review.\n\n${COMMENT_MARKER}\n`);
	});
});
