import { describe, expect, test } from "bun:test";
import type { ScheduleCadence, WorkflowNode } from "@tripwire/contracts";
import {
	committedSchedule,
	editorNextRun,
	formatNextRun,
	invalidScheduleDrafts,
	isClockCadence,
} from "#/lib/schedule-input";

const scheduled = (id: string, every: ScheduleCadence): WorkflowNode => ({
	id,
	type: "trigger",
	kinds: ["schedule.matched"],
	schedule: { every, match: {} },
});

describe("typed schedule drafts", () => {
	test("text the field cannot store is reported with the field's own error", () => {
		expect(
			invalidScheduleDrafts(new Map([["t", "every 3 minutes"]]), [
				scheduled("t", { cron: "*/5 * * * *" }),
			]),
		).toEqual([
			{ nodeId: "t", message: "Runs must be at least 5 minutes apart." },
		]);
	});

	test("an unfinished phrase blocks the save too", () => {
		expect(
			invalidScheduleDrafts(new Map([["t", "every monday"]]), [
				scheduled("t", { preset: "daily", at: "09:00" }),
			]),
		).toEqual([{ nodeId: "t", message: "Add a time, like at 09:00." }]);
	});

	test("a draft on a removed step or an event trigger reports nothing", () => {
		expect(
			invalidScheduleDrafts(
				new Map([
					["gone", "nope"],
					["event", "nope"],
				]),
				[{ id: "event", type: "trigger", kinds: ["change-request.opened"] }],
			),
		).toEqual([]);
	});

	test("valid and empty drafts report nothing", () => {
		expect(
			invalidScheduleDrafts(
				new Map([
					["a", "weekdays at 9"],
					["b", "  "],
				]),
				[
					scheduled("a", { preset: "weekdays", at: "09:00" }),
					scheduled("b", { n: 1, unit: "days" }),
				],
			),
		).toEqual([]);
	});
});

describe("cadence helpers", () => {
	test("only clock cadences carry a zone", () => {
		expect(isClockCadence({ n: 1, unit: "days" })).toBe(false);
		expect(isClockCadence({ cron: "0 7 * * *" })).toBe(true);
		expect(isClockCadence(undefined)).toBe(false);
	});

	test("the next run names its zone", () => {
		const instant = new Date(Date.UTC(2026, 9, 26, 6));
		expect(formatNextRun(instant, "Europe/Berlin")).toBe(
			"Mon, Oct 26, 07:00 GMT+1",
		);
		expect(formatNextRun(instant, "UTC")).toBe("Mon, Oct 26, 06:00 UTC");
	});
});

describe("the editor's next run", () => {
	const now = new Date("2026-10-23T23:01:59.000Z");
	const every5Days = { every: { n: 5, unit: "days" } as const };

	test("an interval on a live workflow counts from its last tick", () => {
		const next = editorNextRun(every5Days, {
			enabled: true,
			saved: every5Days,
			lastTickAt: new Date("2026-10-21T09:10:03.000Z"),
			now,
		});
		expect(next?.toISOString()).toBe("2026-10-26T09:15:00.000Z");
	});

	test("an interval that is off runs at the first tick after it turns on", () => {
		const next = editorNextRun(every5Days, {
			enabled: false,
			saved: every5Days,
			lastTickAt: new Date("2026-10-21T09:10:03.000Z"),
			now,
		});
		expect(next?.toISOString()).toBe("2026-10-23T23:05:00.000Z");
	});

	test("a clock schedule turned on after a stale tick shows the next slot", () => {
		const berlin = {
			every: { cron: "*/15 * * * *" },
			timezone: "Europe/Berlin",
		};
		const next = editorNextRun(berlin, {
			enabled: false,
			saved: berlin,
			lastTickAt: new Date("2026-10-23T21:30:27.000Z"),
			now,
		});
		expect(next?.toISOString()).toBe("2026-10-23T23:15:00.000Z");
	});
});

describe("committing typed schedule text", () => {
	test("text with the same timing keeps the stored schedule", () => {
		const stored = {
			every: { n: 1, unit: "days" as const },
			timezone: undefined,
		};
		expect(
			committedSchedule(stored, {
				every: { n: 24, unit: "hours" },
				timezone: undefined,
			}),
		).toBe(stored);
	});

	test("text with new timing replaces it", () => {
		const typed = {
			every: { preset: "hourly" as const, minute: 0 },
			timezone: "UTC",
		};
		expect(
			committedSchedule(
				{ every: { n: 1, unit: "hours" }, timezone: undefined },
				typed,
			),
		).toBe(typed);
		expect(
			committedSchedule({ every: undefined, timezone: undefined }, typed),
		).toBe(typed);
	});
});
