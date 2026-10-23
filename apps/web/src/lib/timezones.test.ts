import { describe, expect, test } from "bun:test";
import {
	formatClockTime,
	formatDateTime,
	formatShortTime,
	newScheduleTimezone,
	resolveDisplayZone,
	timezoneNames,
} from "#/lib/timezones";

const INSTANT = new Date("2026-10-23T12:34:56Z");

describe("display zone", () => {
	test("the account choice wins, then the org, then the device", () => {
		expect(
			resolveDisplayZone({
				account: "Asia/Tokyo",
				org: "Europe/Berlin",
				device: "America/New_York",
			}),
		).toEqual({ zone: "Asia/Tokyo", source: "account" });
		expect(
			resolveDisplayZone({
				account: null,
				org: "Europe/Berlin",
				device: "America/New_York",
			}),
		).toEqual({ zone: "Europe/Berlin", source: "org" });
		expect(
			resolveDisplayZone({ account: null, org: null, device: "UTC" }),
		).toEqual({ zone: "UTC", source: "device" });
	});
});

describe("new schedule zone", () => {
	test("the org zone comes first, since the org owns the workflow", () => {
		expect(
			newScheduleTimezone({ org: "Europe/Berlin", account: "Asia/Tokyo" }),
		).toBe("Europe/Berlin");
		expect(newScheduleTimezone({ org: null, account: "Asia/Tokyo" })).toBe(
			"Asia/Tokyo",
		);
	});

	test("with neither set the schedule keeps the stated default", () => {
		expect(newScheduleTimezone({ org: null, account: null })).toBeUndefined();
	});
});

describe("formatting", () => {
	test("every time carries its zone", () => {
		expect(formatClockTime(INSTANT, "UTC")).toBe("12:34:56 UTC");
		expect(formatClockTime(INSTANT, "Europe/Berlin")).toBe("14:34:56 GMT+2");
		expect(formatDateTime(INSTANT, "America/New_York")).toBe(
			"Oct 23, 2026, 8:34 AM EDT",
		);
	});

	test("a short time drops the date today and the year this year", () => {
		const now = new Date("2026-10-23T20:00:00Z");
		expect(formatShortTime(INSTANT, "America/New_York", now)).toBe(
			"8:34 AM EDT",
		);
		expect(formatShortTime(new Date("2026-10-21T09:05:00Z"), "UTC", now)).toBe(
			"Oct 21, 9:05 AM UTC",
		);
		expect(formatShortTime(new Date("2025-12-31T23:30:00Z"), "UTC", now)).toBe(
			"Dec 31, 2025, 11:30 PM UTC",
		);
	});

	test("today is today in the display zone, not in UTC", () => {
		const now = new Date("2026-10-23T02:00:00Z");
		const late = new Date("2026-10-22T23:00:00Z");
		expect(formatShortTime(late, "UTC", now)).toBe("Oct 22, 11:00 PM UTC");
		expect(formatShortTime(late, "Asia/Tokyo", now)).toBe("8:00 AM GMT+9");
	});

	test("the zone list always offers UTC", () => {
		expect(timezoneNames()).toContain("UTC");
		expect(timezoneNames()).toContain("Europe/Berlin");
	});
});
