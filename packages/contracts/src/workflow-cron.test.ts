import { describe, expect, test } from "bun:test";
import { triggerScheduleSchema } from "./workflow.ts";
import {
	latestCronRun,
	nextCronRun,
	parseCron,
	zonedInstant,
} from "./workflow-cron.ts";
import {
	cadenceCron,
	describeCadence,
	describeCron,
	describeDuration,
	describeSchedule,
	formatScheduleTime,
	nextScheduleRun,
	scheduleFireTime,
} from "./workflow-schedule.ts";

function spec(expression: string) {
	const parsed = parseCron(expression);
	if (!parsed.ok) {
		throw new Error(parsed.error);
	}
	return parsed.spec;
}

const MATCH = {
	subjects: ["issue"],
	state: "open",
	inactiveFor: { n: 15, unit: "days" },
} as const;

describe("parseCron", () => {
	test("reads ranges, lists, steps and names", () => {
		const read = spec("*/15 9-17 * jan,jul mon-fri");
		expect(read.minutes).toEqual([0, 15, 30, 45]);
		expect(read.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
		expect(read.months).toEqual([1, 7]);
		expect(read.weekdays).toEqual([1, 2, 3, 4, 5]);
	});

	test("7 is Sunday too", () => {
		expect(spec("0 0 * * 7").weekdays).toEqual([0]);
	});

	test("refuses broken expressions with a reason", () => {
		expect(parseCron("0 7 * *")).toEqual({
			ok: false,
			error: "use five fields: minute hour day month weekday",
		});
		expect(parseCron("61 * * * *").ok).toBe(false);
		expect(parseCron("*/0 * * * *").ok).toBe(false);
		expect(parseCron("5-1 * * * *").ok).toBe(false);
	});
});

describe("nextCronRun", () => {
	test("daily at 07:00 in UTC", () => {
		expect(
			nextCronRun(
				spec("0 7 * * *"),
				"UTC",
				new Date("2026-10-23T08:00:00Z"),
			)?.toISOString(),
		).toBe("2026-10-24T07:00:00.000Z");
	});

	test("reads the wall clock of the zone", () => {
		expect(
			nextCronRun(
				spec("0 8 * * *"),
				"Europe/Berlin",
				new Date("2026-10-23T00:00:00Z"),
			)?.toISOString(),
		).toBe("2026-10-23T06:00:00.000Z");
		expect(
			nextCronRun(
				spec("0 8 * * *"),
				"Europe/Berlin",
				new Date("2026-10-26T00:00:00Z"),
			)?.toISOString(),
		).toBe("2026-10-26T07:00:00.000Z");
	});

	test("a time the clock skips runs when the clock comes back", () => {
		expect(
			zonedInstant(
				{ year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
				"Europe/Berlin",
			),
		).toBeNull();
		expect(
			nextCronRun(
				spec("30 2 * * *"),
				"Europe/Berlin",
				new Date("2026-03-28T12:00:00Z"),
			)?.toISOString(),
		).toBe("2026-03-29T01:00:00.000Z");
	});

	test("a stepped day field still ands with the weekday, as in Vixie cron", () => {
		expect(
			nextCronRun(
				spec("0 0 */2 * 1"),
				"UTC",
				new Date("2026-10-23T12:00:00Z"),
			)?.toISOString(),
		).toBe("2026-11-09T00:00:00.000Z");
	});

	test("a repeated hour runs once, at the first pass", () => {
		expect(
			nextCronRun(
				spec("30 2 * * *"),
				"Europe/Berlin",
				new Date("2026-10-24T12:00:00Z"),
			)?.toISOString(),
		).toBe("2026-10-25T00:30:00.000Z");
	});

	test("both day fields set means either one", () => {
		expect(
			nextCronRun(
				spec("0 0 13 * 5"),
				"UTC",
				new Date("2026-10-23T12:00:00Z"),
			)?.toISOString(),
		).toBe("2026-10-30T00:00:00.000Z");
	});
});

describe("schedule schema", () => {
	test("stored interval schedules still parse unchanged", () => {
		const parsed = triggerScheduleSchema.parse({
			every: { n: 12, unit: "hours" },
			match: MATCH,
		});
		expect(parsed.every).toEqual({ n: 12, unit: "hours" });
		expect(parsed.timezone).toBeUndefined();
	});

	test("presets and cron parse, with an optional timezone", () => {
		for (const every of [
			{ preset: "hourly", minute: 15 },
			{ preset: "daily", at: "07:00" },
			{ preset: "weekdays", at: "09:30" },
			{ preset: "weekly", on: "monday", at: "08:00" },
			{ preset: "monthly", day: 1, at: "06:00" },
			{ cron: "0 */12 * * *" },
		]) {
			expect(
				triggerScheduleSchema.safeParse({
					every,
					timezone: "Europe/Berlin",
					match: MATCH,
				}).success,
			).toBe(true);
		}
	});

	test("refuses a cron that never runs, a bad zone and a bad time", () => {
		const issue = (value: { every: unknown; timezone?: string }) => {
			const parsed = triggerScheduleSchema.safeParse({
				...value,
				match: MATCH,
			});
			return parsed.success ? null : parsed.error.issues[0]?.message;
		};
		expect(issue({ every: { cron: "0 0 30 2 *" } })).toBe(
			"this cron never runs. Pick a day the month has",
		);
		expect(issue({ every: { preset: "daily", at: "7am" } })).toBeTruthy();
		expect(
			issue({ every: { n: 1, unit: "days" }, timezone: "Mars/Olympus" }),
		).toBe("Mars/Olympus is not an IANA timezone, like Europe/Berlin");
		expect(issue({ every: { cron: "* * * * *" } })).toBe(
			"runs must be at least 5 minutes apart",
		);
		expect(issue({ every: { cron: "*/5 * * * *" } })).toBeNull();
	});
});

describe("read-back", () => {
	test("presets compile to cron", () => {
		expect(cadenceCron({ preset: "weekly", on: "friday", at: "17:45" })).toBe(
			"45 17 * * 5",
		);
		expect(cadenceCron({ preset: "weekdays", at: "09:00" })).toBe(
			"0 9 * * 1-5",
		);
		expect(cadenceCron({ n: 2, unit: "days" })).toBeNull();
	});

	test("every clock schedule states its zone, defaulted or chosen", () => {
		expect(describeSchedule({ every: { preset: "daily", at: "07:00" } })).toBe(
			"Every day at 07:00 (UTC, the default)",
		);
		expect(
			describeSchedule({
				every: { cron: "0 9 * * 1-5" },
				timezone: "America/New_York",
			}),
		).toBe("At 09:00 on weekdays (America/New_York)");
		expect(describeSchedule({ every: { n: 12, unit: "hours" } })).toBe(
			"Every 12 hours",
		);
	});

	test("durations read in words", () => {
		expect(describeDuration({ n: 1, unit: "months" })).toBe("1 month");
		expect(describeDuration({ n: 15, unit: "days" })).toBe("15 days");
		expect(describeCadence({ n: 1, unit: "weeks" })).toBe("Every week");
	});

	test("common cron shapes read as words, the rest as the expression", () => {
		expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
		expect(describeCron("0 * * * *")).toBe("Every hour");
		expect(describeCron("0 */12 * * *")).toBe("Every day at 00:00 and 12:00");
		expect(describeCron("0 7 * * *")).toBe("Every day at 07:00");
		expect(describeCron("30 8 1 * *")).toBe("At 08:30 on the 1st of the month");
		expect(describeCron("0 0 * * 0,6")).toBe("At 00:00 on weekends");
		expect(describeCadence({ cron: "0 0 13 * 5" })).toBe("Cron 0 0 13 * 5");
	});

	test("next run is shown with its zone", () => {
		const next = nextScheduleRun(
			{
				every: { preset: "weekly", on: "sunday", at: "08:00" },
				timezone: "Europe/Berlin",
			},
			{ after: new Date("2026-10-23T12:00:00Z") },
		);
		expect(next?.toISOString()).toBe("2026-10-25T07:00:00.000Z");
		expect(formatScheduleTime(next ?? new Date(0), "Europe/Berlin")).toBe(
			"Sun, Oct 25, 8:00 AM GMT+1",
		);
	});
});

describe("scheduleFireTime", () => {
	const daily = { every: { preset: "daily", at: "07:00" } } as const;

	test("a cron is due in the tick after its time, once", () => {
		const fire = scheduleFireTime(
			daily,
			new Date("2026-10-23T06:58:00Z"),
			new Date("2026-10-23T07:03:00Z"),
		);
		expect(fire?.toISOString()).toBe("2026-10-23T07:00:00.000Z");
		expect(
			scheduleFireTime(
				daily,
				new Date("2026-10-23T07:03:00Z"),
				new Date("2026-10-23T07:08:00Z"),
			),
		).toBeNull();
	});

	test("a fresh schedule still catches a run one tick late", () => {
		expect(
			scheduleFireTime(
				daily,
				null,
				new Date("2026-10-23T07:08:00Z"),
			)?.toISOString(),
		).toBe("2026-10-23T07:00:00.000Z");
	});

	test("a fresh cron schedule waits for its time", () => {
		expect(
			scheduleFireTime(daily, null, new Date("2026-10-23T12:00:00Z")),
		).toBeNull();
	});

	test("an interval keeps its old tick ids", () => {
		const now = new Date("2026-10-23T13:02:00Z");
		expect(
			scheduleFireTime(
				{ every: { n: 12, unit: "hours" } },
				null,
				now,
			)?.toISOString(),
		).toBe("2026-10-23T12:00:00.000Z");
	});
});

describe("ranges", () => {
	test("a range with two dashes is rejected", () => {
		expect(parseCron("1-2-3 * * * *").ok).toBe(false);
	});
});

describe("cron errors say what to type", () => {
	const error = (expression: string) => {
		const parsed = parseCron(expression);
		return parsed.ok ? null : parsed.error;
	};

	test("a value out of range names the range", () => {
		expect(error("60 * * * *")).toBe("minute must be 0 to 59");
		expect(error("0 25 * * *")).toBe("hour must be 0 to 23");
		expect(error("0 7 0 * *")).toBe("day of month must be 1 to 31");
		expect(error("0 7 * 13 *")).toBe("month must be 1 to 12 or jan to dec");
		expect(error("0 7 * * 8")).toBe("day of week must be 0 to 7 or sun to sat");
		expect(error("0 7 * * mon-fry")).toBe(
			"day of week must be 0 to 7 or sun to sat",
		);
	});

	test("a bad shape, step or range shows the right form", () => {
		expect(error("1-2-3 * * * *")).toBe(
			"minute must be a number, a range like 1-5 or a step like */15",
		);
		expect(error("*/0 * * * *")).toBe(
			"minute step must be a whole number of 1 or more, like */15",
		);
		expect(error("0 9-5 * * *")).toBe(
			"hour range must go from low to high, like 1-5",
		);
	});
});

describe("describeCron says only what the cron runs", () => {
	test("a cron that skips days, minutes or hours never reads as regular", () => {
		expect(describeCron("0 0 */2 * *")).toBeNull();
		expect(describeCron("0 9 */2 * 1")).toBeNull();
		expect(describeCron("0-10/5 * * * *")).toBeNull();
		expect(describeCron("0 */5 * * *")).toBeNull();
		expect(describeCron("0 0 1-31 * 1")).toBe("Every day at 00:00");
	});

	test("an uneven step reads as the times it runs", () => {
		expect(describeCron("0 0-12/6 * * *")).toBe(
			"Every day at 00:00, 06:00 and 12:00",
		);
		expect(describeCron("0 0 * * */2")).toBe(
			"At 00:00 on Sunday, Tuesday, Thursday and Saturday",
		);
	});

	test("an even step still reads as a step", () => {
		expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
		expect(describeCron("0 */6 * * *")).toBe("Every 6 hours at minute 0");
	});
});

describe("catch-up after an outage", () => {
	function walkForward(
		cron: string,
		zone: string,
		after: Date,
		until: Date,
	): Date | null {
		const parsed = parseCron(cron);
		if (!parsed.ok) {
			return null;
		}
		let fire: Date | null = null;
		let cursor = nextCronRun(parsed.spec, zone, after);
		while (cursor && cursor.getTime() <= until.getTime()) {
			fire = cursor;
			cursor = nextCronRun(parsed.spec, zone, cursor);
		}
		return fire;
	}

	test("the latest fire matches a walk through every fire", () => {
		const cases: [string, string, string, string][] = [
			[
				"*/5 * * * *",
				"Europe/Berlin",
				"2026-05-31T18:00:00Z",
				"2026-06-01T23:57:00Z",
			],
			[
				"30 2 * * *",
				"America/New_York",
				"2026-03-07T00:00:00Z",
				"2026-03-08T12:00:00Z",
			],
			[
				"30 1 * * *",
				"America/New_York",
				"2026-10-31T00:00:00Z",
				"2026-11-01T06:10:00Z",
			],
			[
				"*/5 * * * *",
				"America/New_York",
				"2026-11-01T04:00:00Z",
				"2026-11-01T07:02:00Z",
			],
			["0 9 * * 1-5", "UTC", "2026-06-05T10:00:00Z", "2026-06-08T08:59:00Z"],
			[
				"15 2 * * *",
				"Australia/Lord_Howe",
				"2026-10-02T12:00:00Z",
				"2026-10-04T12:00:00Z",
			],
		];
		for (const [cron, zone, after, until] of cases) {
			const parsed = parseCron(cron);
			if (!parsed.ok) {
				throw new Error(parsed.error);
			}
			expect({
				cron,
				zone,
				fire: latestCronRun(
					parsed.spec,
					zone,
					new Date(after),
					new Date(until),
				)?.toISOString(),
			}).toEqual({
				cron,
				zone,
				fire: walkForward(
					cron,
					zone,
					new Date(after),
					new Date(until),
				)?.toISOString(),
			});
		}
	});

	test("a day of missed five-minute fires costs about one fire", () => {
		const now = new Date("2026-06-01T23:57:00Z");
		const started = performance.now();
		for (let i = 0; i < 20; i++) {
			scheduleFireTime(
				{ every: { cron: "*/5 * * * *" }, timezone: "Europe/Berlin" },
				new Date(now.getTime() - 30 * 3_600_000),
				now,
			);
		}
		expect((performance.now() - started) / 20).toBeLessThan(25);
	});
});
