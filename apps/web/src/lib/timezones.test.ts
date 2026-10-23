import { describe, expect, test } from "bun:test";
import {
	formatClockTime,
	formatDateTime,
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

	test("the zone list always offers UTC", () => {
		expect(timezoneNames()).toContain("UTC");
		expect(timezoneNames()).toContain("Europe/Berlin");
	});
});
