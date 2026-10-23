import {
	DEFAULT_SCHEDULE_TIMEZONE,
	type DurationUnit,
	durationMs,
	SCHEDULE_TICK_MINUTES,
	type ScheduleCadence,
	type ScheduleInterval,
	type SchedulePreset,
	type Weekday,
	weekdaySchema,
} from "./workflow.ts";
import { type CronSpec, nextCronRun, parseCron } from "./workflow-cron.ts";

/** How often the worker looks for due schedules. */
export const SCHEDULE_TICK_MS = SCHEDULE_TICK_MINUTES * 60_000;

export function isScheduleInterval(
	cadence: ScheduleCadence,
): cadence is ScheduleInterval {
	return "n" in cadence;
}

function isPreset(cadence: ScheduleCadence): cadence is SchedulePreset {
	return "preset" in cadence;
}

const WEEKDAY_INDEX = {
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
} as const satisfies Record<Weekday, number>;

function clock(at: string) {
	const [hour = "0", minute = "0"] = at.split(":");
	return { hour: Number(hour), minute: Number(minute) };
}

/** The cron a clock-based cadence runs on, or null for an interval. */
export function cadenceCron(cadence: ScheduleCadence): string | null {
	if (isScheduleInterval(cadence)) {
		return null;
	}
	if (!isPreset(cadence)) {
		return cadence.cron.trim();
	}
	if (cadence.preset === "hourly") {
		return `${cadence.minute} * * * *`;
	}
	const { hour, minute } = clock(cadence.at);
	switch (cadence.preset) {
		case "daily":
			return `${minute} ${hour} * * *`;
		case "weekdays":
			return `${minute} ${hour} * * 1-5`;
		case "weekly":
			return `${minute} ${hour} * * ${WEEKDAY_INDEX[cadence.on]}`;
		case "monthly":
			return `${minute} ${hour} ${cadence.day} * *`;
		default:
			return null;
	}
}

export interface ScheduleZone {
	zone: string;
	defaulted: boolean;
}

/** The zone a schedule runs in, and whether it fell back to the default. */
export function scheduleZone(timezone: string | undefined): ScheduleZone {
	return timezone
		? { zone: timezone, defaulted: false }
		: { zone: DEFAULT_SCHEDULE_TIMEZONE, defaulted: true };
}

/** The zone as read-back text: "Europe/Berlin", or "UTC, the default". */
export function zoneLabel(zone: ScheduleZone): string {
	return zone.defaulted ? `${zone.zone}, the default` : zone.zone;
}

const UNIT_WORDS = {
	hours: ["hour", "hours"],
	days: ["day", "days"],
	weeks: ["week", "weeks"],
	months: ["month", "months"],
} as const satisfies Record<DurationUnit, readonly [string, string]>;

export function describeDuration(duration: {
	n: number;
	unit: DurationUnit;
}): string {
	const [one, many] = UNIT_WORDS[duration.unit];
	return `${duration.n} ${duration.n === 1 ? one : many}`;
}

const WEEKDAY_WORDS = weekdaySchema.options.map(
	(day) => `${day.charAt(0).toUpperCase()}${day.slice(1)}`,
);

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function ordinal(day: number): string {
	const teen = day % 100 >= 11 && day % 100 <= 13;
	const suffix = teen ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
	return `${day}${suffix}`;
}

function joinWords(words: readonly string[]): string {
	if (words.length <= 1) {
		return words[0] ?? "";
	}
	return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function isEvery(values: readonly number[], min: number, max: number): boolean {
	return values.length === max - min + 1;
}

function stepOf(values: readonly number[], min: number): number | null {
	const [first, second] = values;
	if (first !== min || second === undefined || values.length < 2) {
		return null;
	}
	const step = second - first;
	return values.every((value, index) => value === min + index * step)
		? step
		: null;
}

function describeWeekdays(days: readonly number[]): string {
	if (days.join(",") === "1,2,3,4,5") {
		return "on weekdays";
	}
	if (days.join(",") === "0,6") {
		return "on weekends";
	}
	return `on ${joinWords(days.map((day) => WEEKDAY_WORDS[day] ?? String(day)))}`;
}

const MAX_LISTED_DAYS = 7;

function describeDays(spec: CronSpec): { part: string | null } | null {
	const allDays = isEvery(spec.days, 1, 31);
	const allWeekdays = isEvery(spec.weekdays, 0, 6);
	if (spec.daysRestricted && spec.weekdaysRestricted) {
		return allDays || allWeekdays ? { part: null } : null;
	}
	if (allDays && allWeekdays) {
		return { part: null };
	}
	if (!(allDays || allWeekdays)) {
		return null;
	}
	if (allDays) {
		return { part: describeWeekdays(spec.weekdays) };
	}
	return spec.days.length > MAX_LISTED_DAYS
		? null
		: { part: `on the ${joinWords(spec.days.map(ordinal))} of the month` };
}

function evenStep(
	values: readonly number[],
	min: number,
	span: number,
): number | null {
	const step = stepOf(values, min);
	const last = values.at(-1);
	return step !== null &&
		last !== undefined &&
		span % step === 0 &&
		last + step === min + span
		? step
		: null;
}

/**
 * Plain words for a cron, or null when the shape is too irregular to say
 * honestly. Callers then show the expression itself.
 */
export function describeCron(expression: string): string | null {
	const parsed = parseCron(expression);
	if (!parsed.ok) {
		return null;
	}
	const spec = parsed.spec;
	if (!isEvery(spec.months, 1, 12)) {
		return null;
	}
	const days = describeDays(spec);
	if (!days) {
		return null;
	}
	const anyDay = days.part === null;
	const dayPart = days.part;
	const allHours = isEvery(spec.hours, 0, 23);
	const allMinutes = isEvery(spec.minutes, 0, 59);
	let time: string | null = null;
	if (allMinutes && allHours) {
		time = "Every minute";
	} else if (allHours) {
		const step = evenStep(spec.minutes, 0, 60);
		if (step) {
			time = `Every ${step} minutes`;
		} else if (spec.minutes.length === 1) {
			const [minute = 0] = spec.minutes;
			time = minute === 0 ? "Every hour" : `Every hour at minute ${minute}`;
		}
	} else if (spec.minutes.length === 1) {
		const [minute = 0] = spec.minutes;
		const step = evenStep(spec.hours, 0, 24);
		if (step && spec.hours.length > 2) {
			time = `Every ${step} hours at minute ${minute}`;
		} else if (spec.hours.length <= 4) {
			time = `At ${joinWords(spec.hours.map((hour) => `${pad(hour)}:${pad(minute)}`))}`;
		}
	}
	if (!time) {
		return null;
	}
	if (anyDay) {
		return time.startsWith("At") ? `Every day ${time.toLowerCase()}` : time;
	}
	return `${time} ${dayPart ?? ""}`.trim();
}

/** The cadence in plain words, without its zone. */
export function describeCadence(cadence: ScheduleCadence): string {
	if (isScheduleInterval(cadence)) {
		return cadence.n === 1
			? `Every ${UNIT_WORDS[cadence.unit][0]}`
			: `Every ${describeDuration(cadence)}`;
	}
	if (isPreset(cadence)) {
		switch (cadence.preset) {
			case "hourly":
				return cadence.minute === 0
					? "Every hour"
					: `Every hour at minute ${cadence.minute}`;
			case "daily":
				return `Every day at ${cadence.at}`;
			case "weekdays":
				return `Weekdays at ${cadence.at}`;
			case "weekly":
				return `Every ${WEEKDAY_WORDS[WEEKDAY_INDEX[cadence.on]]} at ${cadence.at}`;
			case "monthly":
				return `On the ${ordinal(cadence.day)} of every month at ${cadence.at}`;
			default:
				return "On a schedule";
		}
	}
	return describeCron(cadence.cron) ?? `Cron ${cadence.cron.trim()}`;
}

/**
 * The full read-back: the cadence plus the zone it runs in. Intervals are not
 * tied to a clock, so they carry no zone.
 */
export function describeSchedule(schedule: {
	every: ScheduleCadence;
	timezone?: string;
}): string {
	const words = describeCadence(schedule.every);
	if (isScheduleInterval(schedule.every)) {
		return words;
	}
	return `${words} (${zoneLabel(scheduleZone(schedule.timezone))})`;
}

function cronSpec(cadence: ScheduleCadence): CronSpec | null {
	const cron = cadenceCron(cadence);
	if (cron === null) {
		return null;
	}
	const parsed = parseCron(cron);
	return parsed.ok ? parsed.spec : null;
}

/**
 * When the schedule runs next after `after`. An interval runs one interval
 * after its last tick, or at the next worker tick when it never ran.
 */
export function nextScheduleRun(
	schedule: { every: ScheduleCadence; timezone?: string },
	options: { after: Date; lastTickAt?: Date | null },
): Date | null {
	if (isScheduleInterval(schedule.every)) {
		const last = options.lastTickAt;
		if (!last) {
			return options.after;
		}
		const next = new Date(last.getTime() + durationMs(schedule.every));
		return next.getTime() > options.after.getTime() ? next : options.after;
	}
	const spec = cronSpec(schedule.every);
	return spec
		? nextCronRun(spec, scheduleZone(schedule.timezone).zone, options.after)
		: null;
}

const FIRE_LOOKBACK_MS = 24 * 60 * 60_000;

/**
 * The run a tick at `now` owes, as the instant it was due, or null when the
 * schedule is not due. The instant doubles as the tick id, so retries of the
 * same run dedupe.
 */
export function scheduleFireTime(
	schedule: { every: ScheduleCadence; timezone?: string },
	lastTickAt: Date | null,
	now: Date,
): Date | null {
	if (isScheduleInterval(schedule.every)) {
		const size = durationMs(schedule.every);
		const due =
			lastTickAt === null || now.getTime() - lastTickAt.getTime() >= size;
		return due ? new Date(Math.floor(now.getTime() / size) * size) : null;
	}
	const spec = cronSpec(schedule.every);
	if (!spec) {
		return null;
	}
	const zone = scheduleZone(schedule.timezone).zone;
	const anchor = Math.max(
		lastTickAt?.getTime() ?? now.getTime() - 2 * SCHEDULE_TICK_MS,
		now.getTime() - FIRE_LOOKBACK_MS,
	);
	let fire: Date | null = null;
	let cursor = nextCronRun(spec, zone, new Date(anchor));
	while (cursor && cursor.getTime() <= now.getTime()) {
		fire = cursor;
		cursor = nextCronRun(spec, zone, cursor);
	}
	return fire;
}

/**
 * A run time for people: "Sun, Nov 1, 8:00 AM GMT+1". The zone name is
 * always part of the text.
 */
export function formatScheduleTime(
	instant: Date,
	zone: string,
	locale = "en-US",
): string {
	const date = new Intl.DateTimeFormat(locale, {
		timeZone: zone,
		weekday: "short",
		month: "short",
		day: "numeric",
	}).format(instant);
	const time = new Intl.DateTimeFormat(locale, {
		timeZone: zone,
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(instant);
	return `${date}, ${time}`;
}
