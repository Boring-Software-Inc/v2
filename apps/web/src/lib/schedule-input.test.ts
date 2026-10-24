import { describe, expect, test } from "bun:test";
import {
	parseScheduleText,
	type ScheduleCadence,
	type WorkflowNode,
} from "@tripwire/contracts";
import {
	committedSchedule,
	editorNextRun,
	formatNextRun,
	invalidScheduleDrafts,
	isClockCadence,
	showsScheduleZone,
	type TypedSchedule,
	typedScheduleCommit,
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
	const commitEach = (
		saved: { every: ScheduleCadence; timezone?: string } | null,
		texts: readonly string[],
	) => {
		let value: TypedSchedule = saved
			? { every: saved.every, timezone: saved.timezone }
			: { every: undefined, timezone: undefined };
		for (const text of texts) {
			value =
				typedScheduleCommit(text, { saved, current: value, newZone: "UTC" }) ??
				value;
		}
		return value;
	};

	test("text with the same timing keeps the saved schedule", () => {
		expect(
			committedSchedule(
				{ every: { n: 1, unit: "days" } },
				{ every: { n: 24, unit: "hours" }, timezone: undefined },
			),
		).toEqual({ every: { n: 1, unit: "days" }, timezone: undefined });
	});

	test("retyping a saved cron as words keeps the cron", () => {
		const saved = { every: { cron: "0 8 * * 0" }, timezone: "Europe/Berlin" };
		expect(
			commitEach(saved, [
				"",
				"every sunday",
				"every sunday at 8",
				"every sunday at 8am in berlin",
			]),
		).toEqual(saved);
	});

	test("text with new timing replaces it", () => {
		const typed = {
			every: { preset: "hourly" as const, minute: 0 },
			timezone: "UTC",
		};
		expect(committedSchedule({ every: { n: 1, unit: "hours" } }, typed)).toBe(
			typed,
		);
		expect(committedSchedule(null, typed)).toBe(typed);
	});

	test("a clock phrase without a zone keeps the current one", () => {
		expect(
			commitEach({ every: { n: 1, unit: "days" } }, [
				"every sunday at 8am in berlin",
				"every sunday at 9am",
			]),
		).toEqual({
			every: { preset: "weekly", on: "sunday", at: "09:00" },
			timezone: "Europe/Berlin",
		});
	});

	test("clearing the field clears the schedule", () => {
		expect(commitEach({ every: { n: 1, unit: "days" } }, [""])).toEqual({
			every: undefined,
			timezone: undefined,
		});
	});
});

describe("the zone beside the schedule field", () => {
	const shown = (text: string) =>
		showsScheduleZone(text, parseScheduleText(text));

	test("a clock cron without a zone shows it, as the canvas does", () => {
		expect(shown("*/15 * * * *")).toBe(true);
		expect(shown("30 */2 * * *")).toBe(true);
		expect(shown("every 15 minutes")).toBe(true);
		expect(shown("every day at 9")).toBe(true);
	});

	test("an interval, a typed zone or empty text shows none", () => {
		expect(shown("every 2 hours")).toBe(false);
		expect(shown("every 5 days")).toBe(false);
		expect(shown("every day at 9 in berlin")).toBe(false);
		expect(shown("  ")).toBe(false);
	});
});
