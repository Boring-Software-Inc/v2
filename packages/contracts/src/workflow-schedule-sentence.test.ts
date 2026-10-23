import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "./workflow.ts";
import { scheduleReadBacks } from "./workflow-compile.ts";

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
					"Every day at 09:00 (Europe/Berlin), finds open issues with no activity for 3 weeks, labeled needs-info, not labeled pinned, skipping locked ones. Then Comment, Close.",
			},
		]);
	});
});
