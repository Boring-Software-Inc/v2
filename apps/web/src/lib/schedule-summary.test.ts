import { describe, expect, test } from "bun:test";
import {
	DEFAULT_TRIGGER_SCHEDULE,
	type WorkflowDefinition,
	type WorkflowNode,
} from "@tripwire/contracts";
import {
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";
import { threadSubjectOf, threadUrlOf, toEventView } from "#/lib/run-links";
import { scheduleSummary } from "#/lib/schedule-summary";
import { workflowToMarkdown } from "#/lib/workflow-markdown";

const SCHEDULE_TRIGGER: WorkflowNode = {
	id: "t",
	type: "trigger",
	kinds: ["schedule.matched"],
	schedule: {
		every: "12h",
		match: {
			subjects: ["issue", "change-request"],
			state: "closed",
			inactiveDays: 15,
			labels: ["stale"],
			skipLocked: true,
		},
	},
};

const LOCK: WorkflowNode = {
	id: "l",
	type: "action",
	action: "lock",
	params: { reason: "resolved" },
};

function face(node: WorkflowNode): string[] {
	return nodeFieldValues(node).map(
		({ field, value }) =>
			`${field.label}: ${summarizeFieldValue(field, value)}`,
	);
}

const THREAD_EVENT = {
	kind: "schedule.matched",
	occurredAt: "2026-10-21T14:00:00.000Z",
	thread: {
		kind: "issue",
		number: 12,
		title: "Crash on start",
		url: "https://github.com/acme/widgets/issues/12",
		state: "closed",
		author: "octocat",
		labels: [],
		locked: false,
		updatedAt: "2026-09-01T00:00:00.000Z",
	},
};

describe("scheduleSummary", () => {
	test("reads the cadence and the inactivity window", () => {
		expect(scheduleSummary(DEFAULT_TRIGGER_SCHEDULE)).toBe(
			"Every 12 hours, inactive 15 days",
		);
		expect(
			scheduleSummary({
				every: "24h",
				match: { subjects: ["issue"], state: "open", skipLocked: true },
			}),
		).toBe("Every day");
		expect(
			scheduleSummary({
				every: "1h",
				match: {
					subjects: ["issue"],
					state: "open",
					inactiveDays: 1,
					skipLocked: false,
				},
			}),
		).toBe("Every hour, inactive 1 day");
	});
});

describe("node faces", () => {
	test("a schedule trigger shows its cadence", () => {
		expect(face(SCHEDULE_TRIGGER)).toEqual([
			"Triggers on: On a schedule",
			"Runs: Every 12 hours",
			"Inactive for: 15 days",
		]);
	});

	test("lock shows its reason, or none", () => {
		expect(face(LOCK)).toEqual(["Reason: resolved"]);
		expect(face({ ...LOCK, params: undefined })).toEqual(["Reason: none"]);
	});

	test("close has no fields", () => {
		expect(face({ id: "c", type: "action", action: "close" })).toEqual([]);
	});
});

describe("workflowToMarkdown, scheduled", () => {
	const definition: WorkflowDefinition = {
		id: "wf-lock",
		name: "lock inactive",
		version: 1,
		nodes: [SCHEDULE_TRIGGER, LOCK],
		edges: [{ id: "e1", from: "t", to: "l" }],
	};
	const md = workflowToMarkdown(definition);

	test("names the schedule and its filters", () => {
		expect(md).toContain("On a schedule");
		expect(md).toContain(
			"Every 12 hours, inactive 15 days; applies to: issue, change-request; state: closed; with labels: stale; skips locked threads",
		);
	});

	test("lists the lock reason", () => {
		expect(md).toContain("reason: resolved");
	});
});

describe("scheduled run links", () => {
	test("an issue thread links to its issue", () => {
		expect(threadUrlOf(THREAD_EVENT)).toBe(
			"https://github.com/acme/widgets/issues/12",
		);
		expect(threadSubjectOf(null, THREAD_EVENT)).toBe("issue");
	});

	test("the stored subject kind wins, null reads as a change request", () => {
		expect(threadSubjectOf("change-request", THREAD_EVENT)).toBe(
			"change-request",
		);
		expect(threadSubjectOf(null, { kind: "change-request.opened" })).toBe(
			"change-request",
		);
		expect(threadUrlOf({ kind: "change-request.opened" })).toBeNull();
	});

	test("the event view carries the thread title", () => {
		expect(
			toEventView({
				kind: "schedule.matched",
				actorLogin: "octocat",
				headSha: null,
				normalized: THREAD_EVENT,
				receivedAt: new Date("2026-10-21T14:00:00.000Z"),
			}).title,
		).toBe("Crash on start");
	});
});
