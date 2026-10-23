import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "./workflow.ts";
import { scheduleReadBacks } from "./workflow-compile.ts";
import { scheduleFieldLabel } from "./workflow-schedule-sentence.ts";

const STALE: WorkflowDefinition = {
	id: "stale",
	name: "Stale issues",
	version: 1,
	nodes: [
		{
			id: "nightly",
			type: "trigger",
			kinds: ["schedule.matched"],
			schedule: {
				every: { preset: "daily", at: "09:00" },
				timezone: "Europe/Berlin",
				match: {
					subjects: ["issue"],
					state: "open",
					inactiveFor: { n: 3, unit: "weeks" },
					labels: ["needs-info"],
					excludeLabels: ["pinned"],
					skipLocked: true,
				},
			},
		},
		{
			id: "warn",
			type: "action",
			action: "post-comment",
			params: { message: "Closing soon." },
		},
		{ id: "shut", type: "action", action: "close" },
		{ id: "unused", type: "action", action: "lock" },
	],
	edges: [
		{ id: "1", from: "nightly", to: "warn" },
		{ id: "2", from: "warn", to: "shut" },
	],
};

describe("a schedule reads back like the panel", () => {
	test("it says what it applies to, the filters and the actions", () => {
		expect(scheduleReadBacks(STALE)).toEqual([
			{
				nodeId: "nightly",
				summary: "Every day at 09:00 (Europe/Berlin)",
				timezone: "Europe/Berlin",
				defaulted: false,
				description:
					"Every day at 09:00 (Europe/Berlin), finds open issues with no activity for 3 weeks, labeled needs-info, not labeled pinned, skipping locked ones. Then Tripwire posts your comment and closes it.",
			},
		]);
	});
});

describe("schedule fields read as words", () => {
	test("a path becomes the field a person sees in the panel", () => {
		expect(scheduleFieldLabel(["match", "inactiveFor", "n"])).toBe(
			"The inactive time",
		);
		expect(scheduleFieldLabel(["every", "cron"])).toBe("The cron");
		expect(scheduleFieldLabel(["timezone"])).toBe("The timezone");
		expect(scheduleFieldLabel(["match", "labels", 0])).toBe("The labels");
		expect(scheduleFieldLabel(["nope"])).toBeNull();
	});

	test("a schedule names the label each action adds", () => {
		const [read] = scheduleReadBacks({
			...STALE,
			nodes: [
				...STALE.nodes,
				{
					id: "tag",
					type: "action",
					action: "label",
					params: { labels: ["tripwire-stg-acted"] },
				},
			],
			edges: [{ id: "1", from: "nightly", to: "tag" }],
		});
		expect(
			read?.description.endsWith(
				"Then Tripwire adds the label tripwire-stg-acted.",
			),
		).toBe(true);
	});
});
