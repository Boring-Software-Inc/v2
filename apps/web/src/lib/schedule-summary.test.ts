import { describe, expect, test } from "bun:test";
import {
	lintWorkflow,
	NEW_SCHEDULE_DRAFT,
	type RepoLabel,
	scheduleSentenceText,
	scheduleShortSummary,
	scheduleText,
	WORKFLOW_TEMPLATES,
	type WorkflowDefinition,
	type WorkflowNode,
} from "@tripwire/contracts";
import {
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";
import { labelColor, labelOptions } from "#/lib/label-options";
import { threadSubjectOf, threadUrlOf, toEventView } from "#/lib/run-links";
import { workflowToMarkdown } from "#/lib/workflow-markdown";

const SCHEDULE_TRIGGER: WorkflowNode = {
	id: "t",
	type: "trigger",
	kinds: ["schedule.matched"],
	schedule: {
		every: { n: 12, unit: "hours" },
		match: {
			subjects: ["issue", "change-request"],
			state: "closed",
			inactiveFor: { n: 15, unit: "days" },
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

describe("schedule sentence", () => {
	test("a complete schedule reads as one sentence", () => {
		expect(
			scheduleSentenceText({
				every: { n: 12, unit: "hours" },
				match: {
					subjects: ["issue", "change-request"],
					state: "closed",
					inactiveFor: { n: 15, unit: "days" },
					skipLocked: true,
				},
			}),
		).toBe(
			"Every 12 hours, finds closed issues and change requests with no activity for 15 days, skipping locked ones.",
		);
	});

	test("labels narrow the sentence", () => {
		expect(
			scheduleSentenceText({
				every: { n: 1, unit: "days" },
				match: {
					subjects: ["change-request"],
					state: "open",
					inactiveFor: { n: 7, unit: "days" },
					labels: ["stale"],
					excludeLabels: ["no-auto-close", "pinned"],
					skipLocked: false,
				},
			}),
		).toBe(
			"Every 24 hours, finds open change requests with no activity for 7 days, labeled stale, not labeled no-auto-close or pinned.",
		);
	});

	test("an empty schedule shows every gap", () => {
		expect(scheduleSentenceText(NEW_SCHEDULE_DRAFT)).toBe(
			"Every [so often], finds [open or closed] [issues or change requests] with no activity for [some time], skipping locked ones.",
		);
	});

	test("a half filled schedule shows the answers and the gaps", () => {
		expect(
			scheduleSentenceText({
				every: { n: 6, unit: "hours" },
				match: { subjects: ["issue"], state: "any" },
			}),
		).toBe(
			"Every 6 hours, finds open and closed issues with no activity for [some time], skipping locked ones.",
		);
	});
});

describe("node faces", () => {
	test("a schedule trigger shows its cadence and inactivity", () => {
		expect(face(SCHEDULE_TRIGGER)).toEqual([
			"Runs: Every 12 hours",
			"Applies to: Closed issues, change requests",
			"Inactive for: 15 days",
			"With labels: stale",
		]);
	});

	test("a one hour interval reads the same on the node and in the field", () => {
		const every = { n: 1, unit: "hours" } as const;
		const node: WorkflowNode = {
			...SCHEDULE_TRIGGER,
			schedule: { every, match: {} },
		};
		expect(scheduleText({ every })).toBe("every 60 minutes");
		expect(face(node)[0]).toBe("Runs: Every 60 minutes");
		expect(scheduleShortSummary({ every, match: {} })).toBe("Every 60 minutes");
	});

	test("an unanswered schedule says not set", () => {
		expect(face({ ...SCHEDULE_TRIGGER, schedule: NEW_SCHEDULE_DRAFT })).toEqual(
			["Runs: Not set", "Applies to: Not set", "Inactive for: Not set"],
		);
	});

	test("lock shows its reason, or none", () => {
		expect(face(LOCK)).toEqual(["Reason: Resolved"]);
		expect(face({ ...LOCK, params: undefined })).toEqual(["Reason: None"]);
	});

	test("close has no fields", () => {
		expect(face({ id: "c", type: "action", action: "close" })).toEqual([]);
	});

	test("remove label lists its labels and comment shows its message", () => {
		expect(
			face({
				id: "r",
				type: "action",
				action: "remove-label",
				params: { labels: ["stale"] },
			}),
		).toEqual(["Removes: stale"]);
		expect(
			face({
				id: "c",
				type: "action",
				action: "post-comment",
				params: { message: "Closing this." },
			}),
		).toEqual(["Message: Closing this."]);
		expect(face({ id: "c", type: "action", action: "post-comment" })).toEqual([
			"Message: Not set",
		]);
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

	test("names the schedule as a sentence", () => {
		expect(md).toContain("On a schedule");
		expect(md).toContain(
			"Every 12 hours, finds closed issues and change requests with no activity for 15 days, labeled stale, skipping locked ones.",
		);
	});

	test("lists the lock reason", () => {
		expect(md).toContain("reason: resolved");
	});
});

describe("templates", () => {
	test("every template lints clean", () => {
		for (const template of WORKFLOW_TEMPLATES) {
			const results = lintWorkflow({
				...template.definition,
				id: template.id,
				name: template.name,
			});
			expect({ template: template.id, results }).toEqual({
				template: template.id,
				results: [],
			});
		}
	});

	test("every node face in every template shows its values in full", () => {
		for (const template of WORKFLOW_TEMPLATES) {
			for (const node of template.definition.nodes) {
				for (const { field, value } of nodeFieldValues(node)) {
					const shown = summarizeFieldValue(field, value);
					expect(shown).not.toContain("…");
					expect(shown).not.toMatch(/ \+\d+$/);
					if (typeof value === "string") {
						expect(shown).toBe(value);
					}
				}
			}
		}
		const reset = WORKFLOW_TEMPLATES.find(
			(template) => template.id === "close-stale-change-requests",
		)?.definition.nodes.find((node) => node.id === "reset");
		expect(reset && face(reset)).toEqual([
			"When: A change request gets new commits, or someone comments",
		]);
	});

	test("close stale change requests holds three triggers", () => {
		const stale = WORKFLOW_TEMPLATES.find(
			(template) => template.id === "close-stale-change-requests",
		);
		const triggers = stale?.definition.nodes.filter(
			(node) => node.type === "trigger",
		);
		expect(triggers?.map((node) => node.id)).toEqual([
			"warn",
			"close",
			"reset",
		]);
	});
});

describe("label options", () => {
	const synced: RepoLabel[] = [
		{ name: "bug", color: "d73a4a", description: null },
		{ name: "stale", color: "cfd3d7", description: null },
	];

	test("synced labels come first and saved ones stay", () => {
		expect(labelOptions(synced, ["Stale", "pinned"])).toEqual([
			{ name: "bug", color: "d73a4a", synced: true },
			{ name: "stale", color: "cfd3d7", synced: true },
			{ name: "pinned", color: null, synced: false },
		]);
	});

	test("colors match by name, ignoring case", () => {
		const options = labelOptions(synced, []);
		expect(labelColor(options, "BUG")).toBe("d73a4a");
		expect(labelColor(options, "missing")).toBeNull();
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

describe("clock schedules", () => {
	test("the sentence states the zone the schedule runs in", () => {
		expect(
			scheduleShortSummary({
				every: { preset: "daily", at: "07:00" },
				match: { subjects: ["issue"], state: "open" },
			}),
		).toBe("Every day at 07:00 in UTC, open issues");
		expect(
			scheduleShortSummary({
				every: { cron: "0 */12 * * *" },
				timezone: "Europe/Berlin",
				match: {},
			}),
		).toBe("0 */12 * * * in Berlin");
	});
});
