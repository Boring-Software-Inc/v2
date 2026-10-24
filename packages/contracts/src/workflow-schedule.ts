import {
	DEFAULT_SCHEDULE_TIMEZONE,
	type DurationUnit,
	durationMs,
	SCHEDULE_TICK_MINUTES,
	type ScheduleCadence,
	type ScheduleInterval,
	type SchedulePreset,
	type Weekday,
	type WorkflowNode,
	weekdaySchema,
} from "./workflow.ts";
import {
	type CronSpec,
	latestCronRun,
	nextCronRun,
	parseCron,
} from "./workflow-cron.ts";

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

/** The five-minute mark a worker tick starting at `at` belongs to. */
export function scheduleTickSlot(at: Date): Date {
	return new Date(
		Math.floor(at.getTime() / SCHEDULE_TICK_MS) * SCHEDULE_TICK_MS,
	);
}

function slotAtOrAfter(ms: number): number {
	return Math.ceil(ms / SCHEDULE_TICK_MS) * SCHEDULE_TICK_MS;
}

function intervalDueSlot(every: ScheduleInterval, lastTickAt: Date): number {
	return slotAtOrAfter(lastTickAt.getTime() + durationMs(every));
}

const FIRE_LOOKBACK_MS = 24 * 60 * 60_000;

/**
 * The tick slot the schedule runs at next, seen at `after`. An interval runs
 * at the first slot one interval after its last tick. A clock schedule runs at
 * the first slot on or after its next cron time since the last tick.
 */
export function nextScheduleRun(
	schedule: { every: ScheduleCadence; timezone?: string },
	options: { after: Date; lastTickAt?: Date | null },
): Date | null {
	const current = scheduleTickSlot(options.after).getTime();
	const last = options.lastTickAt ?? null;
	if (isScheduleInterval(schedule.every)) {
		return new Date(
			last
				? Math.max(intervalDueSlot(schedule.every, last), current)
				: slotAtOrAfter(options.after.getTime()),
		);
	}
	const spec = cronSpec(schedule.every);
	if (!spec) {
		return null;
	}
	const zone = scheduleZone(schedule.timezone).zone;
	const from = last
		? new Date(Math.max(last.getTime(), current - FIRE_LOOKBACK_MS))
		: options.after;
	const run = nextCronRun(spec, zone, from);
	return run ? new Date(Math.max(slotAtOrAfter(run.getTime()), current)) : null;
}

export interface ScheduleTiming {
	every: ScheduleCadence;
	timezone?: string;
}

function timingKey(schedule: ScheduleTiming): string {
	const every = schedule.every;
	const cadence = isScheduleInterval(every)
		? `every ${durationMs(every)}ms`
		: (cadenceCron(every) ?? JSON.stringify(every));
	return `${cadence} ${scheduleZone(schedule.timezone).zone}`;
}

/** Whether two schedules run at the same instants. */
export function sameScheduleTiming(
	a: ScheduleTiming | null,
	b: ScheduleTiming | null,
): boolean {
	return a !== null && b !== null && timingKey(a) === timingKey(b);
}

/**
 * The last tick a schedule starts over from when it is turned on or its timing
 * changes, so no run missed before that is replayed. A clock schedule counts
 * from `at`. An interval counts as last run one interval before `at`, so it
 * runs at the first tick slot on or after `at`.
 */
export function restartedTickAt(schedule: ScheduleTiming, at: Date): Date {
	return isScheduleInterval(schedule.every)
		? new Date(at.getTime() - durationMs(schedule.every))
		: at;
}

/** The timing of every schedule trigger in a workflow, by node id. */
export function scheduleTimings(definition: {
	nodes: readonly WorkflowNode[];
}): Map<string, ScheduleTiming> {
	const timings = new Map<string, ScheduleTiming>();
	for (const node of definition.nodes) {
		if (node.type === "trigger" && node.schedule?.every) {
			timings.set(node.id, {
				every: node.schedule.every,
				timezone: node.schedule.timezone,
			});
		}
	}
	return timings;
}

/**
 * The schedule triggers that start over when `after` replaces `before`: all
 * of them when the workflow turns on (`before` is null), otherwise those whose
 * timing changed. Each carries the last tick to store, null for none.
 */
export function restartedSchedules(
	before: { nodes: readonly WorkflowNode[] } | null,
	after: { nodes: readonly WorkflowNode[] },
	at: Date,
): { nodeId: string; lastTickAt: Date }[] {
	const previous = before ? scheduleTimings(before) : new Map();
	return [...scheduleTimings(after)]
		.filter(
			([nodeId, timing]) =>
				before === null ||
				!sameScheduleTiming(previous.get(nodeId) ?? null, timing),
		)
		.map(([nodeId, timing]) => ({
			nodeId,
			lastTickAt: restartedTickAt(timing, at),
		}));
}

/**
 * The last tick the worker will count from once the editor's schedule is
 * live: the stored tick while the workflow stays on with the same timing,
 * otherwise a fresh start at `now`.
 */
export function scheduleCountsFrom(input: {
	enabled: boolean;
	saved: ScheduleTiming | null;
	current: ScheduleTiming;
	lastTickAt: Date | null;
	now: Date;
}): Date | null {
	return input.enabled && sameScheduleTiming(input.saved, input.current)
		? input.lastTickAt
		: restartedTickAt(input.current, input.now);
}

/**
 * The run a tick at `now` owes, as the instant it was due, or null when the
 * schedule is not due. The tick counts as its slot, the same slot the editor
 * shows. The instant doubles as the tick id, so retries of the same run dedupe.
 */
export function scheduleFireTime(
	schedule: { every: ScheduleCadence; timezone?: string },
	lastTickAt: Date | null,
	now: Date,
): Date | null {
	const slot = scheduleTickSlot(now).getTime();
	if (isScheduleInterval(schedule.every)) {
		const size = durationMs(schedule.every);
		const due =
			lastTickAt === null ||
			slot >= intervalDueSlot(schedule.every, lastTickAt);
		return due ? new Date(Math.floor(now.getTime() / size) * size) : null;
	}
	const spec = cronSpec(schedule.every);
	if (!spec) {
		return null;
	}
	const zone = scheduleZone(schedule.timezone).zone;
	const anchor = Math.max(
		lastTickAt?.getTime() ?? slot - 2 * SCHEDULE_TICK_MS,
		slot - FIRE_LOOKBACK_MS,
	);
	return latestCronRun(spec, zone, new Date(anchor), new Date(slot));
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
