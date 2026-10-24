import { describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW, type WorkflowDefinition } from "@tripwire/contracts";
import { followsSchedule } from "#/lib/workflows.query";

const SCHEDULED: WorkflowDefinition = {
	id: "w",
	name: "w",
	version: 1,
	nodes: [
		{
			id: "t",
			type: "trigger",
			kinds: ["schedule.matched"],
			schedule: {
				every: { n: 2, unit: "hours" },
				match: { subjects: ["issue"], state: "open" },
			},
		},
		{ id: "c", type: "action", action: "close" },
	],
	edges: [{ id: "e", from: "t", to: "c" }],
};

describe("the workflow detail follows its schedule", () => {
	test("an enabled scheduled workflow refetches when the tab comes back", () => {
		expect(followsSchedule({ enabled: true, definition: SCHEDULED })).toBe(
			true,
		);
	});

	test("an off workflow, one with no schedule, or no data does not", () => {
		expect(followsSchedule({ enabled: false, definition: SCHEDULED })).toBe(
			false,
		);
		expect(
			followsSchedule({ enabled: true, definition: DEFAULT_WORKFLOW }),
		).toBe(false);
		expect(followsSchedule(undefined)).toBe(false);
	});
});
