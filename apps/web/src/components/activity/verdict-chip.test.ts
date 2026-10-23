import { describe, expect, test } from "bun:test";
import type { ActivityGroup, NormalizedEvent } from "@tripwire/contracts";
import {
	groupOutcome,
	groupResult,
	runOutcome,
} from "#/components/activity/verdict-chip";

const done = (verdict: string | null, status = "completed") => ({
	verdict,
	status,
});

describe("runOutcome", () => {
	test("a change request run shows its verdict", () => {
		expect(runOutcome("change-request.updated", done("pass"))).toEqual({
			status: "ok",
			label: "Passed",
		});
		expect(runOutcome("change-request.opened", done("block"))?.label).toBe(
			"Blocked",
		);
	});

	test("a comment or scheduled run never shows a verdict", () => {
		for (const kind of ["comment.created", "schedule.matched"] as const) {
			expect(runOutcome(kind, done("pass"))).toEqual({
				status: "idle",
				label: "Ran",
			});
			expect(runOutcome(kind, done("block"))).toEqual({
				status: "idle",
				label: "Ran",
			});
		}
	});

	test("a run waiting on a person says so, whatever its trigger", () => {
		expect(
			runOutcome("comment.created", done("needs_review", "paused"))?.status,
		).toBe("waiting");
	});

	test("a run whose change request closed while it waited reads closed", () => {
		expect(
			runOutcome("change-request.opened", done("needs_review", "closed")),
		).toEqual({ status: "idle", label: "Closed before review" });
	});

	test("no verdict yet shows nothing", () => {
		expect(
			runOutcome("comment.created", done(null, "running")),
		).toBeUndefined();
		expect(runOutcome("comment.created", null)).toBeUndefined();
	});
});

const OPENED: NormalizedEvent = {
	id: "evt-1",
	forge: "github",
	deliveryId: "d-1",
	repo: { owner: "acme", name: "web", fullName: "acme/web" },
	actor: { login: "g-r-i-m", externalId: "1" },
	occurredAt: "2026-10-23T16:04:00.000Z",
	receivedAt: "2026-10-23T16:04:00.000Z",
	kind: "change-request.opened",
	changeRequest: {
		number: 144,
		title: "Closed early",
		headSha: "abc",
		url: "https://github.com/acme/web/pull/144",
	},
};

function group(status: string, verdict: string): ActivityGroup {
	return {
		repoFullName: "acme/web",
		subjectNumber: 144,
		title: "Closed early",
		url: null,
		actor: { login: "g-r-i-m", avatarUrl: null },
		currentVerdict: verdict,
		currentRunId: "run-1",
		latestActivityAt: "2026-10-23T16:04:00.000Z",
		eventCount: 1,
		timeline: [
			{
				event: OPENED,
				run: { runId: "run-1", verdict, status, reason: null },
			},
		],
	};
}

describe("a change request group", () => {
	test("waiting reads Human review and filters as human review", () => {
		expect(groupOutcome(group("paused", "needs_review"))?.label).toBe(
			"Human review",
		);
		expect(groupResult(group("paused", "needs_review"))).toBe("needs_review");
	});

	test("closed before review reads so and leaves the human review filter", () => {
		expect(groupOutcome(group("closed", "needs_review"))?.label).toBe(
			"Closed before review",
		);
		expect(groupResult(group("closed", "needs_review"))).toBe(
			"closed-before-review",
		);
	});
});
