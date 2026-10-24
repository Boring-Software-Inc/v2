import { describe, expect, test } from "bun:test";
import type { ScheduleCadence } from "./workflow.ts";
import { scheduleCadenceSchema } from "./workflow.ts";
import { nextScheduleRun, sameScheduleTiming } from "./workflow-schedule.ts";
import {
	completeScheduleText,
	describeSchedule,
	parseScheduleText,
	type ScheduleTextParse,
	scheduleText,
} from "./workflow-schedule-text.ts";

const NOW = new Date(Date.UTC(2026, 10, 10, 12, 0));

function parse(text: string): ScheduleTextParse {
	return parseScheduleText(text, { now: NOW });
}

function stored(text: string) {
	const result = parse(text);
	if (!result.ok) {
		throw new Error(`${text}: ${result.message}`);
	}
	return { every: result.every, timezone: result.timezone };
}

describe("phrases the schedule can store", () => {
	const cases: [string, ScheduleCadence, string?][] = [
		["every 5 days", { n: 5, unit: "days" }],
		["every 12 hours", { n: 12, unit: "hours" }],
		["every 1 hour", { preset: "hourly", minute: 0 }],
		["every 1 hour at minute 30", { preset: "hourly", minute: 30 }],
		["every 1 day at 6am", { preset: "daily", at: "06:00" }],
		["every one day at 6am", { preset: "daily", at: "06:00" }],
		[
			"every 1 week on friday at 17:00",
			{ preset: "weekly", on: "friday", at: "17:00" },
		],
		[
			"every 1 month on the 3rd at 8",
			{ preset: "monthly", day: 3, at: "08:00" },
		],
		["every 24 hours", { n: 24, unit: "hours" }],
		["every 7 days", { n: 7, unit: "days" }],
		["every 2 weeks", { n: 2, unit: "weeks" }],
		["Every 52 weeks", { n: 52, unit: "weeks" }],
		["every two days", { n: 2, unit: "days" }],
		["every 12h", { n: 12, unit: "hours" }],
		["each 3 days", { n: 3, unit: "days" }],
		["every 5 minutes", { cron: "*/5 * * * *" }],
		["every 15 mins", { cron: "*/15 * * * *" }],
		["every 30 minutes", { cron: "*/30 * * * *" }],
		["every 120 minutes", { n: 2, unit: "hours" }],
		["every hour", { preset: "hourly", minute: 0 }],
		["hourly", { preset: "hourly", minute: 0 }],
		["every hour at minute 15", { preset: "hourly", minute: 15 }],
		["hourly at :45", { preset: "hourly", minute: 45 }],
		["every 60 minutes", { n: 1, unit: "hours" }],
		["every day at 9am", { preset: "daily", at: "09:00" }],
		["daily at 18:30", { preset: "daily", at: "18:30" }],
		["every day at noon", { preset: "daily", at: "12:00" }],
		["every day at midnight", { preset: "daily", at: "00:00" }],
		["every day at 12am", { preset: "daily", at: "00:00" }],
		["every day at 12pm", { preset: "daily", at: "12:00" }],
		["every day at 7:30 pm", { preset: "daily", at: "19:30" }],
		["every day at 7.30", { preset: "daily", at: "07:30" }],
		["weekdays at 9am", { preset: "weekdays", at: "09:00" }],
		["every weekday at 09:00", { preset: "weekdays", at: "09:00" }],
		["on weekdays at 9", { preset: "weekdays", at: "09:00" }],
		["mon-fri at 8", { preset: "weekdays", at: "08:00" }],
		["every monday at 7:00", { preset: "weekly", on: "monday", at: "07:00" }],
		["every monday 7:00", { preset: "weekly", on: "monday", at: "07:00" }],
		["mondays at 7", { preset: "weekly", on: "monday", at: "07:00" }],
		[
			"weekly on friday at 17:00",
			{ preset: "weekly", on: "friday", at: "17:00" },
		],
		["every sun at 6am", { preset: "weekly", on: "sunday", at: "06:00" }],
		["every monday and thursday at 9", { cron: "0 9 * * 1,4" }],
		["every tue, thu at 10:15", { cron: "15 10 * * 2,4" }],
		["weekends at 10", { cron: "0 10 * * 0,6" }],
		["monthly on the 1st at 07:00", { preset: "monthly", day: 1, at: "07:00" }],
		[
			"every month on the 15th at 8am",
			{ preset: "monthly", day: 15, at: "08:00" },
		],
		[
			"on the 2nd of every month at 6",
			{ preset: "monthly", day: 2, at: "06:00" },
		],
		[
			"every month on day 28 at 23:59",
			{ preset: "monthly", day: 28, at: "23:59" },
		],
		[
			"monthly on the 31st at 07:00, skipping shorter months",
			{ cron: "0 7 31 * *" },
		],
		["0 */12 * * *", { cron: "0 */12 * * *" }],
		["  0 7 1 * *  ", { cron: "0 7 1 * *" }],
		["*/10 * * * 1-5", { cron: "*/10 * * * 1-5" }],
	];
	test.each(cases)("%p", (text, every) => {
		const result = stored(text);
		expect(result.every).toEqual(every);
		expect(scheduleCadenceSchema.safeParse(result.every).success).toBe(true);
	});
});

describe("timezones in the text", () => {
	const cases: [string, string | undefined][] = [
		["every monday 7:00 berlin", "Europe/Berlin"],
		["every monday at 7:00 in Berlin", "Europe/Berlin"],
		["weekdays at 9 in Europe/Berlin", "Europe/Berlin"],
		["weekdays at 9 europe/berlin time", "Europe/Berlin"],
		["every day at 9 new york", "America/New_York"],
		["every day at 9 in new york", "America/New_York"],
		["every day at 9 utc", "UTC"],
		["every day at 9 UTC", "UTC"],
		["every day at 9 in gmt", "UTC"],
		["0 7 * * * in tokyo", "Asia/Tokyo"],
		["every 15 minutes in berlin", "Europe/Berlin"],
		["every day at 9", undefined],
	];
	test.each(cases)("%p", (text, zone) => {
		expect(stored(text).timezone).toBe(zone);
	});

	test("the zone token names the zone and its offset", () => {
		const result = parse("every monday 7:00 berlin");
		const zone = result.tokens.find((token) => token.kind === "zone");
		expect(zone).toMatchObject({
			from: 18,
			to: 24,
			label: "Europe/Berlin, UTC+1",
		});
	});

	test("a summer date shows the summer offset", () => {
		const result = parseScheduleText("daily at 9 berlin", {
			now: new Date(Date.UTC(2026, 6, 1)),
		});
		expect(result.tokens.at(-1)?.label).toBe("Europe/Berlin, UTC+2");
	});

	test("India names its half hour offset", () => {
		const result = parse("daily at 9 kolkata");
		expect(result.tokens.at(-1)?.label).toBe("Asia/Kolkata, UTC+5:30");
	});
});

describe("tokens name what was read", () => {
	test("D's parsed example reads as three tokens", () => {
		const result = parse("every monday 7:00 berlin");
		expect(
			result.tokens.map(({ text, kind, label }) => [text, kind, label]),
		).toEqual([
			["every monday", "cadence", "Every Monday"],
			["7:00", "time", "07:00"],
			["berlin", "zone", "Europe/Berlin, UTC+1"],
		]);
	});

	test("an interval keeps every apart from its count", () => {
		const result = parse("every 5 days");
		expect(result.tokens.map((token) => token.text)).toEqual([
			"every",
			"5 days",
		]);
		expect(result.tokens.every((token) => token.tone === "ok")).toBe(true);
	});

	test("token offsets slice the original text", () => {
		for (const text of [
			"  Every  Monday   at 7:00 pm  in   New York ",
			"monthly on the 1st at 07:00",
			"0 */12 * * * berlin",
			"weekdays at 9am",
		]) {
			for (const token of parse(text).tokens) {
				expect(text.slice(token.from, token.to)).toBe(token.text);
			}
		}
	});

	test("a raw cron reads as one token in plain words", () => {
		expect(parse("0 */12 * * *").tokens).toEqual([
			{
				from: 0,
				to: 12,
				text: "0 */12 * * *",
				kind: "cron",
				label: "Every day at 00:00 and 12:00",
				tone: "ok",
			},
		]);
	});
});

describe("the 5 minute floor", () => {
	test("every 3 minutes is below the floor with a fix", () => {
		const result = parse("every 3 minutes");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("floor");
		expect(result.message).toBe("Runs must be at least 5 minutes apart.");
		expect(result.fixes).toEqual([
			{ label: "Use 5 minutes", text: "every 5 minutes" },
		]);
		expect(result.tokens.map(({ text, tone }) => [text, tone])).toEqual([
			["every", "ok"],
			["3 minutes", "fail"],
		]);
	});

	test.each([
		["every minute", "every 5 minutes"],
		["every 1 minute", "every 5 minutes"],
		["every 4 mins in berlin", "every 5 mins in berlin"],
	])("%p offers %p", (text, fix) => {
		const result = parse(text);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("floor");
		expect(result.fixes[0]?.text).toBe(fix);
		expect(parse(fix).ok).toBe(true);
	});

	test("a cron below the floor says the same", () => {
		const result = parse("* * * * *");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("floor");
		expect(result.message).toBe("Runs must be at least 5 minutes apart.");
		expect(result.fixes).toEqual([
			{ label: "Use 5 minutes", text: "*/5 * * * *" },
		]);
	});

	test("minutes that do not divide the hour point at the nearest that do", () => {
		const result = parse("every 7 minutes");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toBe(
			"Minutes must divide the hour evenly, like 10, 15 or 30.",
		);
		expect(result.fixes).toEqual([
			{ label: "Use 6 minutes", text: "every 6 minutes" },
		]);
	});
});

describe("ambiguous days of the month", () => {
	test("every month on the 31st asks what to do with short months", () => {
		const result = parse("every month on the 31st");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("ambiguous");
		expect(result.message).toBe("Five months have no 31st.");
		expect(result.fixes.map((fix) => fix.label)).toEqual([
			"Skip those months",
			"Run on the 28th instead",
		]);
		expect(result.tokens.map(({ text, tone }) => [text, tone])).toEqual([
			["every month", "ok"],
			["on the 31st", "warn"],
		]);
		const [skip, earlier] = result.fixes;
		expect(stored(skip?.text ?? "").every).toEqual({ cron: "0 9 31 * *" });
		expect(stored(earlier?.text ?? "").every).toEqual({
			preset: "monthly",
			day: 28,
			at: "09:00",
		});
	});

	test("a time already given is kept by both fixes", () => {
		const result = parse("monthly on the 30th at 7:15 berlin");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toBe("February has no 30th.");
		const [skip, earlier] = result.fixes;
		expect(stored(skip?.text ?? "")).toEqual({
			every: { cron: "15 7 30 * *" },
			timezone: "Europe/Berlin",
		});
		expect(stored(earlier?.text ?? "")).toEqual({
			every: { preset: "monthly", day: 28, at: "07:15" },
			timezone: "Europe/Berlin",
		});
	});

	test("the 29th names February in common years", () => {
		const result = parse("monthly on the 29th at 9");
		expect(result.ok ? null : result.message).toBe(
			"February has no 29th most years.",
		);
	});

	test("day 32 does not exist", () => {
		const result = parse("monthly on the 32nd at 9");
		expect(result.ok ? null : result.message).toBe(
			"A month has at most 31 days.",
		);
	});
});

describe("phrases the schedule cannot store", () => {
	test("an interval with a time of day offers the closest storable schedule", () => {
		const result = parse("every 5 days at 6am");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("unstorable");
		expect(result.message).toBe(
			"An interval counts from the last run, so it has no time of day.",
		);
		expect(result.fixes).toEqual([
			{ label: "Drop the time", text: "every 5 days" },
		]);
		expect(result.tokens.find((token) => token.kind === "time")?.tone).toBe(
			"fail",
		);
	});

	test("one week with a time asks for the day", () => {
		const result = parse("every 1 week at 06:00");
		expect(result.ok ? null : result.message).toBe(
			"Add a day, like every monday.",
		);
		expect(result.ok ? [] : result.fixes.map((fix) => fix.text)).toEqual([
			"every monday at 06:00",
		]);
	});

	test("an interval with a zone drops the zone", () => {
		const result = parse("every 5 days in berlin");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toBe(
			"An interval counts from the last run, so it has no timezone.",
		);
		expect(result.fixes).toEqual([
			{ label: "Drop the timezone", text: "every 5 days" },
		]);
	});

	test("months are not an interval unit", () => {
		const result = parse("every 2 months");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toBe("An interval counts hours, days or weeks.");
		expect(result.fixes).toEqual([
			{ label: "Use 9 weeks", text: "every 9 weeks" },
		]);
	});

	test("more than a year apart is refused", () => {
		const result = parse("every 53 weeks");
		expect(result.ok ? null : result.message).toBe(
			"Runs must be at most 52 weeks apart.",
		);
		expect(result.ok ? null : result.fixes[0]?.text).toBe("every 52 weeks");
	});

	test("an hour of the clock on an hourly schedule", () => {
		const result = parse("every hour at 9am");
		expect(result.ok ? null : result.message).toBe(
			"An hourly schedule takes a minute, like at minute 15.",
		);
	});
});

describe("unfinished phrases", () => {
	test.each([
		["every monday", "Add a time, like at 09:00.", "every monday at 09:00"],
		["weekdays", "Add a time, like at 09:00.", "weekdays at 09:00"],
		[
			"every day in berlin",
			"Add a time, like at 09:00.",
			"every day in berlin at 09:00",
		],
		[
			"every month",
			"Add a day, like on the 1st.",
			"every month on the 1st at 09:00",
		],
		[
			"every month at 7",
			"Add a day, like on the 1st.",
			"every month at 7 on the 1st",
		],
		["every 5", "Add a unit, like every 5 days.", "every 5 days"],
		["every week", "Add a day, like every monday.", "every monday at 09:00"],
		["every 1 day", "Add a time, like at 09:00.", "every 1 day at 09:00"],
		["at 9", "Add how often, like every day.", "every day at 9"],
	])("%p", (text, message, fix) => {
		const result = parse(text);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("incomplete");
		expect(result.message).toBe(message);
		expect(result.fixes[0]?.text ?? null).toBe(fix);
		if (fix) {
			expect(parse(fix).ok).toBe(true);
		}
	});

	test("empty text has no message", () => {
		expect(parse("   ")).toMatchObject({ ok: false, reason: "empty" });
	});

	test("an unknown word is named and marked", () => {
		const result = parse("every fortnight");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("unknown");
		expect(result.message).toBe('Could not read "fortnight".');
		expect(result.tokens.at(-1)).toMatchObject({
			text: "fortnight",
			tone: "fail",
		});
	});

	test.each([
		["every day at 25:00", "Use a time from 00:00 to 23:59."],
		["every day at 13pm", "Use a time from 00:00 to 23:59."],
		["every day at 9 in atlantis", 'Could not read "atlantis".'],
		["0 7 * *", "Use five fields: minute hour day month weekday."],
		["0 7 31 2 *", "This cron never runs. Pick a day the month has."],
	])("%p", (text, message) => {
		const result = parse(text);
		expect(result.ok ? null : result.message).toBe(message);
	});
});

describe("canonical text", () => {
	const cases: [ScheduleCadence, string | undefined, string][] = [
		[{ n: 5, unit: "days" }, undefined, "every 5 days"],
		[{ n: 1, unit: "days" }, undefined, "every 24 hours"],
		[{ n: 1, unit: "weeks" }, undefined, "every 7 days"],
		[{ n: 1, unit: "hours" }, undefined, "every 60 minutes"],
		[{ n: 12, unit: "hours" }, "Europe/Berlin", "every 12 hours"],
		[{ preset: "hourly", minute: 0 }, undefined, "every hour"],
		[{ preset: "hourly", minute: 15 }, "UTC", "every hour at minute 15 in UTC"],
		[{ preset: "daily", at: "09:00" }, undefined, "every day at 09:00"],
		[{ preset: "weekdays", at: "09:00" }, undefined, "weekdays at 09:00"],
		[
			{ preset: "weekly", on: "monday", at: "07:00" },
			"Europe/Berlin",
			"every monday at 07:00 in Berlin",
		],
		[
			{ preset: "monthly", day: 1, at: "07:00" },
			"America/New_York",
			"monthly on the 1st at 07:00 in New York",
		],
		[{ cron: "*/15 * * * *" }, undefined, "every 15 minutes"],
		[{ cron: "0 9 * * 1,4" }, undefined, "every monday and thursday at 09:00"],
		[{ cron: "0 10 * * 0,6" }, undefined, "weekends at 10:00"],
		[
			{ cron: "0 7 31 * *" },
			undefined,
			"monthly on the 31st at 07:00, skipping shorter months",
		],
		[{ cron: "0 */12 * * *" }, undefined, "0 */12 * * *"],
		[{ cron: "0 9 * * *" }, undefined, "0 9 * * *"],
		[{ cron: "0 9 * * mon" }, "Asia/Tokyo", "0 9 * * mon in Tokyo"],
		[
			{ cron: "0 9 * * *" },
			"America/Argentina/Buenos_Aires",
			"0 9 * * * in Buenos Aires",
		],
	];
	test.each(cases)("%j in %p", (every, timezone, text) => {
		expect(scheduleText({ every, timezone })).toBe(text);
	});
});

describe("round trips", () => {
	const ZONES = [
		undefined,
		"UTC",
		"Europe/Berlin",
		"America/New_York",
		"America/Los_Angeles",
		"Asia/Kolkata",
		"Australia/Lord_Howe",
		"America/Argentina/Buenos_Aires",
	];
	const CADENCES: ScheduleCadence[] = [
		...[1, 2, 5, 12, 24, 36].map((n) => ({ n, unit: "hours" as const })),
		...[3, 5, 7, 30, 364].map((n) => ({ n, unit: "days" as const })),
		...[2, 4, 52].map((n) => ({ n, unit: "weeks" as const })),
		...[0, 1, 15, 30, 59].map((minute) => ({
			preset: "hourly" as const,
			minute,
		})),
		...["00:00", "07:05", "09:00", "12:00", "23:59"].flatMap((at) => [
			{ preset: "daily" as const, at },
			{ preset: "weekdays" as const, at },
			{ preset: "weekly" as const, on: "wednesday" as const, at },
			{ preset: "monthly" as const, day: 28, at },
		]),
		...(
			[
				"sunday",
				"monday",
				"tuesday",
				"wednesday",
				"thursday",
				"friday",
				"saturday",
			] as const
		).map((on) => ({ preset: "weekly" as const, on, at: "08:30" })),
		...[1, 2, 3, 11, 12, 13, 21, 22, 23].map((day) => ({
			preset: "monthly" as const,
			day,
			at: "06:00",
		})),
		...[
			"*/5 * * * *",
			"*/20 * * * *",
			"0 */12 * * *",
			"0 9 * * 1,4",
			"30 18 * * 0,6",
			"0 9 * * 1,2,3",
			"0 7 29 * *",
			"0 7 30 * *",
			"0 7 31 * *",
			"0 9 * * 1-5",
			"15 3 1 1 *",
			"0 0 1,15 * *",
		].map((cron) => ({ cron })),
	];
	const pairs = CADENCES.flatMap((every) =>
		ZONES.map((timezone) => ({ every, timezone })),
	);

	test(`${pairs.length} schedules survive text and back`, () => {
		for (const schedule of pairs) {
			const text = scheduleText(schedule);
			const result = parse(text);
			if (!result.ok) {
				throw new Error(`${text}: ${result.message}`);
			}
			const interval = "n" in schedule.every;
			expect({ text, every: result.every, timezone: result.timezone }).toEqual({
				text,
				every: schedule.every,
				timezone: interval ? undefined : schedule.timezone,
			});
			expect(scheduleText(result)).toBe(text);
		}
	});

	test("one hour, day or week means the same as the words without a count", () => {
		for (const [counted, plain] of [
			["every 1 hour", "every hour"],
			["every 1 hour at minute 15", "every hour at minute 15"],
			["every 1 day at 07:00", "every day at 07:00"],
			[
				"every 1 week on monday at 07:00 berlin",
				"every monday at 07:00 berlin",
			],
			["every 1 month on the 1st at 07:00", "monthly on the 1st at 07:00"],
		] as const) {
			const one = stored(counted);
			expect(one).toEqual(stored(plain));
			expect(stored(scheduleText(one))).toEqual(one);
		}
	});

	test("every stored interval reads back with the same timing", () => {
		const max = { hours: 52 * 7 * 24, days: 52 * 7, weeks: 52 } as const;
		for (const unit of ["hours", "days", "weeks"] as const) {
			for (let n = 1; n <= max[unit]; n++) {
				const schedule = { every: { n, unit } };
				const back = stored(scheduleText(schedule));
				expect(sameScheduleTiming(back, schedule)).toBe(true);
				if (n > 1 || unit === "hours") {
					expect(back.every).toEqual(schedule.every);
				}
			}
		}
	});

	test("a one-hour interval stays an interval when its text is edited", () => {
		const text = scheduleText({ every: { n: 1, unit: "hours" } });
		for (const edited of [text, `${text} `, ` ${text.toUpperCase()}`]) {
			expect(stored(edited).every).toEqual({ n: 1, unit: "hours" });
		}
	});

	test("canonical text is stable for every phrase the parser accepts", () => {
		for (const text of [
			"every monday 7:00 berlin",
			"mon-fri at 8",
			"every tue, thu at 10:15",
			"on the 2nd of every month at 6",
			"every 120 minutes",
			"hourly at :45",
		]) {
			const first = stored(text);
			const canonical = scheduleText(first);
			expect(stored(canonical)).toEqual(first);
		}
	});
});

describe("daylight saving time", () => {
	test("Berlin at 02:30 on spring-forward day runs after the gap", () => {
		const schedule = stored("every sunday at 2:30 in berlin");
		const next = nextScheduleRun(schedule, {
			after: new Date(Date.UTC(2026, 2, 28, 12)),
		});
		expect(next?.toISOString()).toBe("2026-03-29T01:00:00.000Z");
	});

	test("New York at 01:30 on fall-back day runs once, at the first 01:30", () => {
		const schedule = stored("every sunday at 1:30 new york");
		const next = nextScheduleRun(schedule, {
			after: new Date(Date.UTC(2026, 10, 1, 4)),
		});
		expect(next?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
		const after = nextScheduleRun(schedule, { after: next ?? NOW });
		expect(after?.toISOString()).toBe("2026-11-08T06:30:00.000Z");
	});

	test("the zone label follows the offset on the day it is read", () => {
		const winter = parseScheduleText("daily at 9 new york", {
			now: new Date(Date.UTC(2026, 0, 10)),
		});
		const summer = parseScheduleText("daily at 9 new york", {
			now: new Date(Date.UTC(2026, 6, 10)),
		});
		expect(winter.tokens.at(-1)?.label).toBe("America/New_York, UTC-5");
		expect(summer.tokens.at(-1)?.label).toBe("America/New_York, UTC-4");
	});

	test("the zone label uses the offset at the next run, across a change", () => {
		const result = parseScheduleText("every monday 7:00 berlin", {
			now: new Date("2026-10-23T22:43:00.000Z"),
		});
		expect(result.tokens.at(-1)?.label).toBe("Europe/Berlin, UTC+1");
		const cron = parseScheduleText("0 7 * * 1 berlin", {
			now: new Date("2026-10-23T22:43:00.000Z"),
		});
		expect(cron.tokens.at(-1)?.label).toBe("Europe/Berlin, UTC+1");
	});

	test("Lord Howe shifts by half an hour", () => {
		const result = parseScheduleText("daily at 9 lord howe", {
			now: new Date(Date.UTC(2026, 6, 10)),
		});
		expect(result.tokens.at(-1)?.label).toBe("Australia/Lord_Howe, UTC+10:30");
	});
});

describe("ghost completion", () => {
	test.each([
		["every mon", "day at 09:00"],
		["every monday", " at 09:00"],
		["every monday ", "at 09:00"],
		["every monday at", " 09:00"],
		["every 5", " days"],
		["every 5 m", "inutes"],
		["every 12 h", "ours"],
		["every month", " on the 1st at 09:00"],
		["weekd", "ays at 09:00"],
		["every monday at 7 in ber", "lin"],
		["every monday at 7 in new y", "ork"],
		["ev", "ery 5 days"],
		["Every Mon", "day at 09:00"],
	])("%p completes with %p", (text, suffix) => {
		expect(completeScheduleText(text)).toBe(suffix);
		expect(parse(text + suffix).ok).toBe(true);
	});

	test.each([
		"",
		"every 5 days",
		"weekdays at 9",
		"every 3 minutes",
		"every month on the 31st",
		"every fortnight",
	])("%p has no suggestion", (text) => {
		expect(completeScheduleText(text)).toBeNull();
	});
});

describe("one wording everywhere", () => {
	const cases: [ScheduleCadence, string | undefined, string][] = [
		[{ n: 1, unit: "hours" }, undefined, "Every 60 minutes"],
		[{ n: 1, unit: "weeks" }, undefined, "Every 7 days"],
		[{ n: 12, unit: "hours" }, "Europe/Berlin", "Every 12 hours"],
		[{ preset: "hourly", minute: 0 }, undefined, "Every hour in UTC"],
		[{ preset: "daily", at: "07:00" }, undefined, "Every day at 07:00 in UTC"],
		[
			{ preset: "daily", at: "09:00" },
			"Europe/Berlin",
			"Every day at 09:00 in Berlin",
		],
		[{ cron: "0 */12 * * *" }, "Europe/Berlin", "0 */12 * * * in Berlin"],
	];
	test.each(cases)("%j in %p", (every, timezone, text) => {
		expect(describeSchedule({ every, timezone })).toBe(text);
	});

	test("the read-back is the field's text with the zone it runs in", () => {
		expect(describeSchedule({ every: { n: 1, unit: "hours" } })).toBe(
			"Every 60 minutes",
		);
		expect(scheduleText({ every: { n: 1, unit: "hours" } })).toBe(
			"every 60 minutes",
		);
	});

	test("the read-back parses to the same timing", () => {
		const schedules = [
			{ every: { n: 1, unit: "hours" } },
			{ every: { n: 3, unit: "days" } },
			{ every: { preset: "hourly", minute: 0 } },
			{ every: { preset: "weekdays", at: "08:30" }, timezone: "Asia/Tokyo" },
			{ every: { cron: "5,20,35,50 * * * *" } },
		] as const satisfies readonly {
			every: ScheduleCadence;
			timezone?: string;
		}[];
		for (const schedule of schedules) {
			const back = stored(describeSchedule(schedule));
			expect(back.every).toEqual(schedule.every);
			expect(
				sameScheduleTiming(
					{ every: back.every, timezone: back.timezone },
					schedule,
				),
			).toBe(true);
		}
	});
});
