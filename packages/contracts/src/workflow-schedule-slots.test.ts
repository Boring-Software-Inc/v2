import { describe, expect, test } from "bun:test";
import type { ScheduleCadence } from "./workflow.ts";
import {
	nextScheduleRun,
	restartedTickAt,
	SCHEDULE_TICK_MS,
	scheduleFireTime,
	scheduleTickSlot,
} from "./workflow-schedule.ts";

type Schedule = { every: ScheduleCadence; timezone?: string };

const SECOND = 1000;
const JITTERS = [0, 1, 5, 19, 24, 34, 45, 59, 60].map((s) => s * SECOND);
const HORIZON = 30 * 86_400_000;

function firstFire(
	schedule: Schedule,
	lastTickAt: Date | null,
	from: Date,
	jitter: number,
): { slot: Date; tickAt: Date } | null {
	let slot = scheduleTickSlot(from).getTime();
	while (slot < from.getTime() + HORIZON) {
		const tickAt = new Date(slot + jitter);
		if (
			tickAt.getTime() > from.getTime() &&
			scheduleFireTime(schedule, lastTickAt, tickAt)
		) {
			return { slot: new Date(slot), tickAt };
		}
		slot += SCHEDULE_TICK_MS;
	}
	return null;
}

function expectAgreement(
	schedule: Schedule,
	lastTickAt: Date | null,
	from: Date,
	runs = 3,
) {
	for (const jitter of JITTERS) {
		const passed = new Date(scheduleTickSlot(from).getTime() + jitter);
		if (passed <= from && scheduleFireTime(schedule, lastTickAt, passed)) {
			continue;
		}
		let last = lastTickAt;
		let at = from;
		for (let run = 0; run < runs; run++) {
			const shown = nextScheduleRun(schedule, { after: at, lastTickAt: last });
			const fired = firstFire(schedule, last, at, jitter);
			expect({ jitter, run, slot: fired?.slot.toISOString() }).toEqual({
				jitter,
				run,
				slot: shown?.toISOString(),
			});
			if (!fired) {
				return;
			}
			last = scheduleTickSlot(fired.tickAt);
			at = new Date(fired.tickAt.getTime() + 3 * SECOND);
		}
	}
}

const EVERY = {
	"every hour": { every: { n: 1, unit: "hours" } },
	"every 12 hours": { every: { n: 12, unit: "hours" } },
	"every 5 days": { every: { n: 5, unit: "days" } },
	"every 2 weeks": { every: { n: 2, unit: "weeks" } },
} satisfies Record<string, Schedule>;

const CLOCK = {
	"every 5 minutes": { every: { cron: "*/5 * * * *" } },
	"every 15 minutes in Berlin": {
		every: { cron: "*/15 * * * *" },
		timezone: "Europe/Berlin",
	},
	"hourly at minute 7": { every: { preset: "hourly", minute: 7 } },
	"daily at 09:00 in Berlin": {
		every: { preset: "daily", at: "09:00" },
		timezone: "Europe/Berlin",
	},
	"weekly on monday at 07:03 in New York": {
		every: { preset: "weekly", on: "monday", at: "07:03" },
		timezone: "America/New_York",
	},
} satisfies Record<string, Schedule>;

const LAST_TICKS = [
	"2026-10-24T00:25:18.961Z",
	"2026-10-24T00:25:00.000Z",
	"2026-10-24T00:29:59.999Z",
	"2026-10-24T00:30:00.000Z",
];

const VIEW_DELAYS = [3 * SECOND, 100 * SECOND, 290 * SECOND];

describe("tick slots", () => {
	test("a tick belongs to the five-minute mark it started after", () => {
		expect(
			scheduleTickSlot(new Date("2026-10-24T00:25:18.961Z")).toISOString(),
		).toBe("2026-10-24T00:25:00.000Z");
		expect(
			scheduleTickSlot(new Date("2026-10-24T00:30:00.000Z")).toISOString(),
		).toBe("2026-10-24T00:30:00.000Z");
	});

	test("R9-1: every 12 hours ticked at 00:25:18.961 fires at the shown 12:30, not 12:25", () => {
		const schedule = EVERY["every 12 hours"];
		const last = new Date("2026-10-24T00:25:18.961Z");
		const shown = nextScheduleRun(schedule, {
			after: new Date("2026-10-24T00:26:00Z"),
			lastTickAt: last,
		});
		expect(shown?.toISOString()).toBe("2026-10-24T12:30:00.000Z");
		expect(
			scheduleFireTime(schedule, last, new Date("2026-10-24T12:25:24Z")),
		).toBeNull();
		expect(
			scheduleFireTime(schedule, last, new Date("2026-10-24T12:30:05Z")),
		).not.toBeNull();
	});

	test("a tick stored as its slot shows and fires one interval later on the mark", () => {
		const schedule = EVERY["every 12 hours"];
		const last = scheduleTickSlot(new Date("2026-10-24T00:25:18.961Z"));
		const shown = nextScheduleRun(schedule, {
			after: new Date("2026-10-24T00:26:00Z"),
			lastTickAt: last,
		});
		expect(shown?.toISOString()).toBe("2026-10-24T12:25:00.000Z");
		expect(
			firstFire(
				schedule,
				last,
				new Date("2026-10-24T00:26:00Z"),
				59 * SECOND,
			)?.slot.toISOString(),
		).toBe("2026-10-24T12:25:00.000Z");
	});
});

describe("the editor's next run is the worker's first firing slot, ticks 0 to 60 s late", () => {
	for (const [name, schedule] of Object.entries({ ...EVERY, ...CLOCK })) {
		for (const lastTick of LAST_TICKS) {
			for (const delay of VIEW_DELAYS) {
				test(`${name}, last tick ${lastTick}, viewed ${delay / SECOND} s later`, () => {
					const last = new Date(lastTick);
					expectAgreement(schedule, last, new Date(last.getTime() + delay));
				});
			}
		}
	}
});

describe("turning on or editing a schedule inside a tick's late window", () => {
	const SAVES = [
		"2026-10-24T12:25:00.000Z",
		"2026-10-24T12:25:00.500Z",
		"2026-10-24T12:25:10.000Z",
		"2026-10-24T12:25:40.000Z",
		"2026-10-24T12:27:30.000Z",
		"2026-10-24T12:29:59.999Z",
	];
	for (const [name, schedule] of Object.entries({ ...EVERY, ...CLOCK })) {
		for (const save of SAVES) {
			test(`${name}, saved ${save}`, () => {
				const at = new Date(save);
				expectAgreement(schedule, restartedTickAt(schedule, at), at);
			});
		}
	}

	test("a restarted interval runs at the first mark after the save", () => {
		const schedule = EVERY["every 12 hours"];
		const at = new Date("2026-10-24T12:25:10Z");
		expect(
			nextScheduleRun(schedule, {
				after: at,
				lastTickAt: restartedTickAt(schedule, at),
			})?.toISOString(),
		).toBe("2026-10-24T12:30:00.000Z");
	});
});

describe("interval tick ids", () => {
	const schedule = EVERY["every 12 hours"];

	test("two ticks in the same slot share one id", () => {
		const last = new Date("2026-10-24T00:25:00Z");
		expect(
			scheduleFireTime(schedule, last, new Date("2026-10-24T12:25:05Z")),
		).toEqual(
			scheduleFireTime(schedule, last, new Date("2026-10-24T12:25:50Z")),
		);
	});

	test("a restart inside the same interval window fires with a new id", () => {
		const firstTick = new Date("2026-10-24T12:05:12Z");
		const first = scheduleFireTime(schedule, null, firstTick);
		const saved = new Date("2026-10-24T12:40:30Z");
		const restarted = restartedTickAt(schedule, saved);
		const tickAt = new Date("2026-10-24T12:45:20Z");
		const second = scheduleFireTime(schedule, restarted, tickAt);
		expect(first?.toISOString()).toBe("2026-10-24T12:05:00.000Z");
		expect(second?.toISOString()).toBe("2026-10-24T12:45:00.000Z");
	});

	test("every firing of a run of ticks gets its own id", () => {
		const ids = new Set<string>();
		let last: Date | null = null;
		for (
			let at = Date.parse("2026-10-24T00:00:34Z");
			at < Date.parse("2026-10-27T00:00:00Z");
			at += SCHEDULE_TICK_MS
		) {
			const fire = scheduleFireTime(schedule, last, new Date(at));
			if (fire) {
				ids.add(fire.toISOString());
				last = scheduleTickSlot(new Date(at));
			}
		}
		expect([...ids]).toEqual([
			"2026-10-24T00:00:00.000Z",
			"2026-10-24T12:00:00.000Z",
			"2026-10-25T00:00:00.000Z",
			"2026-10-25T12:00:00.000Z",
			"2026-10-26T00:00:00.000Z",
			"2026-10-26T12:00:00.000Z",
		]);
	});
});
