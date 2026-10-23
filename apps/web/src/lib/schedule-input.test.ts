import { describe, expect, test } from "bun:test";
import type { ScheduleCadence, WorkflowNode } from "@tripwire/contracts";
import {
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
