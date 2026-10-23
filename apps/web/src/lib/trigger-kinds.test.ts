import { describe, expect, test } from "bun:test";
import { NEW_SCHEDULE_DRAFT, type TriggerNode } from "@tripwire/contracts";
import {
	EVENT_KIND_OPTIONS,
	eventSentence,
	switchTriggerPath,
	toggleTriggerKind,
	triggerPath,
} from "#/lib/trigger-kinds";

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
	schedule: { ...NEW_SCHEDULE_DRAFT, every: { n: 6, unit: "hours" } },
};

describe("toggleTriggerKind", () => {
	test("ticking on a schedule clears every event kind", () => {
		const next = toggleTriggerKind(EVENTS, "schedule.matched", true);
		expect(next.kinds).toEqual(["schedule.matched"]);
		expect(next.schedule).toEqual(NEW_SCHEDULE_DRAFT);
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
		expect(next.schedule?.every).toEqual({ n: 6, unit: "hours" });
	});
});

describe("switchTriggerPath", () => {
	test("reads the path from the node", () => {
		expect(triggerPath(EVENTS)).toBe("event");
		expect(triggerPath(SCHEDULED)).toBe("schedule");
		expect(triggerPath({ ...EVENTS, kinds: [] })).toBe("event");
	});

	test("going to a schedule clears the events and starts a fresh schedule", () => {
		const next = switchTriggerPath(EVENTS, "schedule");
		expect(next.kinds).toEqual(["schedule.matched"]);
		expect(next.schedule).toEqual(NEW_SCHEDULE_DRAFT);
		expect(next.position).toEqual({ x: 0, y: 0 });
	});

	test("going to events clears the schedule and asks for events", () => {
		const next = switchTriggerPath(SCHEDULED, "event");
		expect(next.kinds).toEqual([]);
		expect("schedule" in next).toBe(false);
	});

	test("choosing the current path changes nothing", () => {
		expect(switchTriggerPath(SCHEDULED, "schedule")).toBe(SCHEDULED);
		expect(switchTriggerPath(EVENTS, "event")).toBe(EVENTS);
	});
});

describe("eventSentence", () => {
	const text = (kinds: Parameters<typeof eventSentence>[0]) =>
		eventSentence(kinds)
			.map((part) => (part.placeholder ? `[${part.text}]` : part.text))
			.join("");

	test("names every chosen event", () => {
		expect(text(["change-request.updated", "comment.created"])).toBe(
			"Runs on change request updated or comment created.",
		);
		expect(text(["push"])).toBe("Runs on push.");
	});

	test("no events leaves a gap", () => {
		expect(text([])).toBe("Runs when [something happens].");
	});

	test("the event list leaves out the schedule", () => {
		expect(EVENT_KIND_OPTIONS.map((entry) => entry.kind)).not.toContain(
			"schedule.matched",
		);
	});
});
