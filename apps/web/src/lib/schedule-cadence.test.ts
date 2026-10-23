import { describe, expect, test } from "bun:test";
import { describeCadence, scheduleCadenceSchema } from "@tripwire/contracts";
import {
	CADENCE_KIND_OPTIONS,
	cadenceForKind,
	cadenceKind,
	isClockCadence,
} from "#/lib/schedule-cadence";

describe("cadence kinds", () => {
	test("each stored shape names its kind", () => {
		expect(cadenceKind({ n: 12, unit: "hours" })).toBe("interval");
		expect(cadenceKind({ preset: "monthly", day: 1, at: "07:00" })).toBe(
			"monthly",
		);
		expect(cadenceKind({ cron: "0 7 1 * *" })).toBe("cron");
	});

	test("every kind starts from a cadence the schema accepts", () => {
		for (const option of CADENCE_KIND_OPTIONS) {
			const cadence = cadenceForKind(option.value, undefined);
			expect(scheduleCadenceSchema.safeParse(cadence).success).toBe(true);
			expect(cadenceKind(cadence)).toBe(option.value);
		}
	});

	test("switching keeps the time of day", () => {
		expect(cadenceForKind("weekly", { preset: "daily", at: "07:30" })).toEqual({
			preset: "weekly",
			on: "monday",
			at: "07:30",
		});
	});

	test("switching to cron keeps what the preset meant", () => {
		const cron = cadenceForKind("cron", {
			preset: "monthly",
			day: 1,
			at: "07:00",
		});
		expect(cron).toEqual({ cron: "0 7 1 * *" });
		expect(describeCadence(cron)).toBe("At 07:00 on the 1st of the month");
	});

	test("picking the same kind keeps the cadence", () => {
		const daily = { preset: "daily", at: "18:00" } as const;
		expect(cadenceForKind("daily", daily)).toBe(daily);
	});

	test("only clock cadences carry a zone", () => {
		expect(isClockCadence({ n: 1, unit: "days" })).toBe(false);
		expect(isClockCadence({ cron: "0 7 * * *" })).toBe(true);
		expect(isClockCadence(undefined)).toBe(false);
	});
});
