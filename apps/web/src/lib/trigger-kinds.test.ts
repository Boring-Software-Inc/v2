import { describe, expect, test } from "bun:test";
import {
	DEFAULT_TRIGGER_SCHEDULE,
	type TriggerNode,
} from "@tripwire/contracts";
import { toggleTriggerKind } from "#/lib/trigger-kinds";

const EVENTS: TriggerNode = {
	id: "t",
	type: "trigger",
	kinds: ["change-request.opened", "push"],
	position: { x: 0, y: 0 },
};

const SCHEDULED: TriggerNode = {
	id: "t",
	type: "trigger",
	kinds: ["schedule.matched"],
	schedule: { ...DEFAULT_TRIGGER_SCHEDULE, every: "6h" },
};

describe("toggleTriggerKind", () => {
	test("ticking on a schedule clears every event kind", () => {
		const next = toggleTriggerKind(EVENTS, "schedule.matched", true);
		expect(next.kinds).toEqual(["schedule.matched"]);
		expect(next.schedule).toEqual(DEFAULT_TRIGGER_SCHEDULE);
		expect(next.position).toEqual({ x: 0, y: 0 });
	});

	test("ticking an event kind clears the schedule", () => {
		const next = toggleTriggerKind(SCHEDULED, "comment.created", true);
		expect(next.kinds).toEqual(["comment.created"]);
		expect("schedule" in next).toBe(false);
	});

	test("unticking on a schedule drops its settings", () => {
		const next = toggleTriggerKind(SCHEDULED, "schedule.matched", false);
		expect(next.kinds).toEqual([]);
		expect("schedule" in next).toBe(false);
	});

	test("event kinds still combine with each other", () => {
		expect(
			toggleTriggerKind(EVENTS, "change-request.closed", true).kinds,
		).toEqual(["change-request.opened", "push", "change-request.closed"]);
		expect(toggleTriggerKind(EVENTS, "push", false).kinds).toEqual([
			"change-request.opened",
		]);
	});

	test("a schedule ticked again keeps its settings", () => {
		const next = toggleTriggerKind(SCHEDULED, "schedule.matched", true);
		expect(next.schedule?.every).toBe("6h");
	});
});
