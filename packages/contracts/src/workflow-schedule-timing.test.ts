import { describe, expect, test } from "bun:test";
import type { ScheduleCadence } from "./workflow.ts";
import {
	nextScheduleRun,
	restartedTickAt,
	SCHEDULE_TICK_MS,
	sameScheduleTiming,
	scheduleCountsFrom,
	scheduleFireTime,
} from "./workflow-schedule.ts";

const NOW = new Date("2026-10-23T23:01:59.000Z");
const STALE = new Date("2026-10-23T21:30:27.000Z");
const EVERY_15: ScheduleCadence = { cron: "*/15 * * * *" };
const BERLIN_15 = { every: EVERY_15, timezone: "Europe/Berlin" };
const EVERY_12H = { every: { n: 12, unit: "hours" } as const };

function firstWorkerRun(
	schedule: { every: ScheduleCadence; timezone?: string },
	lastTickAt: Date | null,
	from: Date,
): Date | null {
	const start = Math.ceil(from.getTime() / SCHEDULE_TICK_MS) * SCHEDULE_TICK_MS;
	for (let at = start; at < from.getTime() + 15 * 86_400_000; ) {
		const fire = scheduleFireTime(schedule, lastTickAt, new Date(at));
		if (fire) {
			return new Date(at);
		}
		at += SCHEDULE_TICK_MS;
	}
	return null;
}

describe("schedule timing", () => {
	test("a zone left out reads the same as UTC, a new zone or cadence does not", () => {
		expect(
			sameScheduleTiming(
				{ every: { preset: "daily", at: "09:00" } },
				{ every: { preset: "daily", at: "09:00" }, timezone: "UTC" },
			),
		).toBe(true);
		expect(
			sameScheduleTiming(BERLIN_15, { every: EVERY_15, timezone: "UTC" }),
		).toBe(false);
		expect(sameScheduleTiming(BERLIN_15, EVERY_12H)).toBe(false);
		expect(sameScheduleTiming(null, BERLIN_15)).toBe(false);
	});

	test("intervals of the same length run at the same instants", () => {
		expect(
			sameScheduleTiming(
				{ every: { n: 1, unit: "days" } },
				{ every: { n: 24, unit: "hours" } },
			),
		).toBe(true);
		expect(
			sameScheduleTiming(
				{ every: { n: 1, unit: "weeks" } },
				{ every: { n: 7, unit: "days" } },
			),
		).toBe(true);
		expect(
			sameScheduleTiming(
				{ every: { n: 1, unit: "hours" } },
				{ every: { preset: "hourly", minute: 0 } },
			),
		).toBe(false);
	});

	test("a restart counts a clock schedule from now and an interval from its first tick", () => {
		expect(restartedTickAt(BERLIN_15, NOW)).toEqual(NOW);
		expect(restartedTickAt(EVERY_12H, NOW)).toBeNull();
	});
});

describe("turning a schedule on after a stale tick (R8-2)", () => {
	test("the worker does not replay the run it missed", () => {
		const countsFrom = scheduleCountsFrom({
			enabled: false,
			saved: BERLIN_15,
			current: BERLIN_15,
			lastTickAt: STALE,
			now: NOW,
		});
		expect(countsFrom).toEqual(NOW);
		expect(
			scheduleFireTime(BERLIN_15, countsFrom, new Date("2026-10-23T23:05:26Z")),
		).toBeNull();
	});

	test("the editor's next run is the worker's first run", () => {
		const countsFrom = scheduleCountsFrom({
			enabled: false,
			saved: BERLIN_15,
			current: BERLIN_15,
			lastTickAt: STALE,
			now: NOW,
		});
		const shown = nextScheduleRun(BERLIN_15, {
			after: NOW,
			lastTickAt: countsFrom,
		});
		expect(shown?.toISOString()).toBe("2026-10-23T23:15:00.000Z");
		expect(firstWorkerRun(BERLIN_15, countsFrom, NOW)).toEqual(shown);
	});
});

describe("editing the schedule of a live workflow (R8-2)", () => {
	test("a new cadence starts over", () => {
		const daily = {
			every: { preset: "daily", at: "09:00" } as const,
			timezone: "Europe/Berlin",
		};
		const countsFrom = scheduleCountsFrom({
			enabled: true,
			saved: BERLIN_15,
			current: daily,
			lastTickAt: STALE,
			now: NOW,
		});
		expect(countsFrom).toEqual(NOW);
		const shown = nextScheduleRun(daily, {
			after: NOW,
			lastTickAt: countsFrom,
		});
		expect(firstWorkerRun(daily, countsFrom, NOW)).toEqual(shown);
	});

	test("an interval starts over at the next worker tick", () => {
		const countsFrom = scheduleCountsFrom({
			enabled: true,
			saved: BERLIN_15,
			current: EVERY_12H,
			lastTickAt: STALE,
			now: NOW,
		});
		expect(countsFrom).toBeNull();
		const shown = nextScheduleRun(EVERY_12H, {
			after: NOW,
			lastTickAt: countsFrom,
		});
		expect(shown?.toISOString()).toBe("2026-10-23T23:05:00.000Z");
		expect(firstWorkerRun(EVERY_12H, countsFrom, NOW)).toEqual(shown);
	});
});

describe("normal ticking is unchanged", () => {
	test("a live schedule with the same timing keeps its last tick", () => {
		const last = new Date("2026-10-23T22:45:10.000Z");
		expect(
			scheduleCountsFrom({
				enabled: true,
				saved: BERLIN_15,
				current: { every: EVERY_15, timezone: "Europe/Berlin" },
				lastTickAt: last,
				now: NOW,
			}),
		).toEqual(last);
	});

	test("an interval runs at the first worker tick one interval after its last tick", () => {
		const last = new Date("2026-10-23T12:00:20.000Z");
		const shown = nextScheduleRun(EVERY_12H, { after: NOW, lastTickAt: last });
		expect(shown?.toISOString()).toBe("2026-10-24T00:05:00.000Z");
		expect(firstWorkerRun(EVERY_12H, last, NOW)).toEqual(shown);
	});

	test("every 5 days and every 2 weeks agree with the worker too", () => {
		const fiveDays = { every: { n: 5, unit: "days" } as const };
		const last = new Date("2026-10-21T09:10:03.000Z");
		const shown = nextScheduleRun(fiveDays, { after: NOW, lastTickAt: last });
		expect(firstWorkerRun(fiveDays, last, NOW)).toEqual(shown);
		const weeks = { every: { n: 2, unit: "weeks" } as const };
		const recent = new Date("2026-10-11T22:55:02.000Z");
		const soon = nextScheduleRun(weeks, { after: NOW, lastTickAt: recent });
		expect(firstWorkerRun(weeks, recent, NOW)).toEqual(soon);
	});
});
