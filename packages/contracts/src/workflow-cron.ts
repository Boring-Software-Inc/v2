/**
 * Five-field cron (minute hour day-of-month month day-of-week), read in an IANA
 * timezone. Supports `*`, numbers, ranges, lists, steps and three-letter month
 * and weekday names. When both day fields are restricted, a day matches either
 * one, as in Vixie cron.
 */

export interface CronSpec {
	minutes: readonly number[];
	hours: readonly number[];
	days: readonly number[];
	months: readonly number[];
	weekdays: readonly number[];
	daysRestricted: boolean;
	weekdaysRestricted: boolean;
}

export type CronParse =
	| { ok: true; spec: CronSpec }
	| { ok: false; error: string };

const MONTH_NAMES = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

interface FieldShape {
	name: string;
	min: number;
	max: number;
	names?: readonly string[];
	nameBase?: number;
}

const FIELDS: readonly FieldShape[] = [
	{ name: "minute", min: 0, max: 59 },
	{ name: "hour", min: 0, max: 23 },
	{ name: "day of month", min: 1, max: 31 },
	{ name: "month", min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
	{ name: "day of week", min: 0, max: 7, names: WEEKDAY_NAMES, nameBase: 0 },
];

function readValue(raw: string, field: FieldShape): number | null {
	const lower = raw.toLowerCase();
	const named = field.names?.indexOf(lower) ?? -1;
	if (named >= 0) {
		return named + (field.nameBase ?? 0);
	}
	if (!/^\d+$/.test(raw)) {
		return null;
	}
	const value = Number(raw);
	return value >= field.min && value <= field.max ? value : null;
}

type FieldRead = { ok: true; values: number[] } | { ok: false; error: string };

function readField(raw: string, field: FieldShape): FieldRead {
	const values = new Set<number>();
	for (const part of raw.split(",")) {
		const [range = "", stepRaw] = part.split("/");
		const step = stepRaw === undefined ? 1 : Number(stepRaw);
		if (!(Number.isInteger(step) && step >= 1)) {
			return { ok: false, error: `${field.name} has a bad step "${part}"` };
		}
		let low: number | null;
		let high: number | null;
		if (range === "*") {
			low = field.min;
			high = field.max;
		} else if (range.includes("-")) {
			const [a = "", b = ""] = range.split("-");
			low = readValue(a, field);
			high = readValue(b, field);
		} else {
			low = readValue(range, field);
			high = stepRaw === undefined ? low : field.max;
		}
		if (low === null || high === null || low > high) {
			return { ok: false, error: `${field.name} cannot read "${part}"` };
		}
		for (let value = low; value <= high; value += step) {
			values.add(value);
		}
	}
	return { ok: true, values: [...values].sort((a, b) => a - b) };
}

export function parseCron(expression: string): CronParse {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) {
		return {
			ok: false,
			error: "use five fields: minute hour day month weekday",
		};
	}
	const read: number[][] = [];
	for (const [index, field] of FIELDS.entries()) {
		const value = readField(parts[index] ?? "", field);
		if (!value.ok) {
			return value;
		}
		read.push(value.values);
	}
	const [minutes = [], hours = [], days = [], months = [], rawWeekdays = []] =
		read;
	const weekdays = [
		...new Set(rawWeekdays.map((day) => (day === 7 ? 0 : day))),
	].sort((a, b) => a - b);
	return {
		ok: true,
		spec: {
			minutes,
			hours,
			days,
			months,
			weekdays,
			daysRestricted: parts[2] !== "*",
			weekdaysRestricted: parts[4] !== "*",
		},
	};
}

export function isValidTimeZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

interface WallTime {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
	const cached = FORMATTERS.get(zone);
	if (cached) {
		return cached;
	}
	const made = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		hourCycle: "h23",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
	});
	FORMATTERS.set(zone, made);
	return made;
}

/** The wall-clock fields of an instant in a timezone. */
export function wallTime(instant: Date, zone: string): WallTime {
	const parts = formatter(zone).formatToParts(instant);
	const field = (type: Intl.DateTimeFormatPartTypes): number =>
		Number(parts.find((part) => part.type === type)?.value ?? "0");
	return {
		year: field("year"),
		month: field("month"),
		day: field("day"),
		hour: field("hour"),
		minute: field("minute"),
	};
}

function offsetMs(instant: number, zone: string): number {
	const wall = wallTime(new Date(instant), zone);
	const asUtc = Date.UTC(
		wall.year,
		wall.month - 1,
		wall.day,
		wall.hour,
		wall.minute,
	);
	const floored = instant - (((instant % 60_000) + 60_000) % 60_000);
	return asUtc - floored;
}

/**
 * The instant a wall-clock time names in a timezone, or null when the clock
 * skips it (a spring-forward gap). In a fall-back overlap the earlier instant
 * wins.
 */
export function zonedInstant(wall: WallTime, zone: string): Date | null {
	const guess = Date.UTC(
		wall.year,
		wall.month - 1,
		wall.day,
		wall.hour,
		wall.minute,
	);
	const candidates = [
		guess - offsetMs(guess - 36 * 3_600_000, zone),
		guess - offsetMs(guess + 36 * 3_600_000, zone),
		guess - offsetMs(guess, zone),
	].sort((a, b) => a - b);
	for (const candidate of candidates) {
		const back = wallTime(new Date(candidate), zone);
		if (
			back.year === wall.year &&
			back.month === wall.month &&
			back.day === wall.day &&
			back.hour === wall.hour &&
			back.minute === wall.minute
		) {
			return new Date(candidate);
		}
	}
	return null;
}

function dayMatches(spec: CronSpec, date: Date): boolean {
	const day = date.getUTCDate();
	const weekday = date.getUTCDay();
	const byDay = spec.days.includes(day);
	const byWeekday = spec.weekdays.includes(weekday);
	if (spec.daysRestricted && spec.weekdaysRestricted) {
		return byDay || byWeekday;
	}
	return byDay && byWeekday;
}

const SEARCH_DAYS = 366 * 5;

/** The first time strictly after `after` that the cron fires, in `zone`. */
export function nextCronRun(
	spec: CronSpec,
	zone: string,
	after: Date,
): Date | null {
	const start = wallTime(after, zone);
	const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
	for (let step = 0; step <= SEARCH_DAYS; step++) {
		if (
			spec.months.includes(cursor.getUTCMonth() + 1) &&
			dayMatches(spec, cursor)
		) {
			for (const hour of spec.hours) {
				for (const minute of spec.minutes) {
					const instant = zonedInstant(
						{
							year: cursor.getUTCFullYear(),
							month: cursor.getUTCMonth() + 1,
							day: cursor.getUTCDate(),
							hour,
							minute,
						},
						zone,
					);
					if (instant && instant.getTime() > after.getTime()) {
						return instant;
					}
				}
			}
		}
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return null;
}
