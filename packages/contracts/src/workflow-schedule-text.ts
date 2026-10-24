import {
	DEFAULT_SCHEDULE_TIMEZONE,
	DURATION_UNIT_MS,
	type EveryUnit,
	MAX_SCHEDULE_EVERY_MS,
	SCHEDULE_TICK_MINUTES,
	type ScheduleCadence,
	scheduleCronSchema,
	weekdaySchema,
} from "./workflow.ts";
import {
	type CronSpec,
	cronRunsOn,
	isValidTimeZone,
	parseCron,
	sameCron,
} from "./workflow-cron.ts";
import {
	cadenceCron,
	isScheduleInterval,
	nextScheduleRun,
} from "./workflow-schedule.ts";

export type ScheduleTokenKind =
	| "cadence"
	| "interval"
	| "time"
	| "minute"
	| "day"
	| "zone"
	| "skip"
	| "cron"
	| "unknown";

export type ScheduleTokenTone = "ok" | "warn" | "fail";

export interface ScheduleToken {
	from: number;
	to: number;
	text: string;
	kind: ScheduleTokenKind;
	label: string;
	tone: ScheduleTokenTone;
}

export interface ScheduleFix {
	label: string;
	text: string;
}

export type ScheduleTextProblem =
	| "empty"
	| "incomplete"
	| "unknown"
	| "floor"
	| "ambiguous"
	| "unstorable"
	| "invalid";

export type ScheduleTextParse =
	| {
			ok: true;
			every: ScheduleCadence;
			timezone: string | undefined;
			tokens: ScheduleToken[];
	  }
	| {
			ok: false;
			reason: ScheduleTextProblem;
			message: string;
			fixes: ScheduleFix[];
			tokens: ScheduleToken[];
	  };

export interface ScheduleTextOptions {
	now?: Date;
}

const DEFAULT_TIME = "09:00";

interface Word {
	text: string;
	lower: string;
	from: number;
	to: number;
}

interface Span {
	from: number;
	to: number;
}

type IntervalUnit = EveryUnit | "minutes" | "months";

type BaseKind =
	| "hourly"
	| "daily"
	| "weekly"
	| "monthly"
	| "weekdays"
	| "weekends"
	| "week";

interface Clock {
	hour: number;
	minute: number;
	valid: boolean;
}

interface Read {
	every?: Span;
	interval?: Span & {
		n: number;
		unit: IntervalUnit | null;
		count: Span | null;
		unitWord: string;
	};
	base?: Span & { kind: BaseKind; days: number[] };
	weekdaySpan?: Span;
	monthOf?: Span;
	time?: Span & Clock & { times: Clock[] };
	atDangling?: Span;
	minute?: Span & { value: number };
	day?: Span & { value: number; values: number[] };
	zone?: Span & { id: string };
	skip?: Span;
	unknown?: Span;
	everyDangling?: Span;
}

const WEEKDAYS = weekdaySchema.options;

const WEEKDAY_NAMES = new Map<string, number>([
	...WEEKDAYS.flatMap((day, index) =>
		[day, `${day}s`, day.slice(0, 3)].map((name) => [name, index] as const),
	),
	["tues", 2],
	["thur", 4],
	["thurs", 4],
]);

const NUMBER_WORDS = new Map(
	Object.entries({
		one: 1,
		two: 2,
		three: 3,
		four: 4,
		five: 5,
		six: 6,
		seven: 7,
		eight: 8,
		nine: 9,
		ten: 10,
		eleven: 11,
		twelve: 12,
	} satisfies Record<string, number>),
);

const COMPACT_UNITS = new Map(
	Object.entries({
		m: "minutes",
		h: "hours",
		d: "days",
		w: "weeks",
	} satisfies Record<string, IntervalUnit>),
);

const UNIT_WORDS = new Map(
	Object.entries({
		min: "minutes",
		mins: "minutes",
		minute: "minutes",
		minutes: "minutes",
		hr: "hours",
		hrs: "hours",
		hour: "hours",
		hours: "hours",
		day: "days",
		days: "days",
		wk: "weeks",
		wks: "weeks",
		week: "weeks",
		weeks: "weeks",
		month: "months",
		months: "months",
	} satisfies Record<string, IntervalUnit>),
);

const SINGLE_UNIT = new Map(
	Object.entries({
		minute: "minute",
		hour: "hourly",
		day: "daily",
		week: "week",
		month: "monthly",
	} satisfies Record<string, BaseKind | "minute">),
);

const KEYWORDS = new Map(
	Object.entries({
		hourly: "hourly",
		daily: "daily",
		weekly: "weekly",
		monthly: "monthly",
		weekday: "weekdays",
		weekdays: "weekdays",
		"mon-fri": "weekdays",
		"monday-friday": "weekdays",
		weekend: "weekends",
		weekends: "weekends",
	} satisfies Record<string, BaseKind>),
);

const ZONE_ALIASES = new Map(
	Object.entries({
		utc: DEFAULT_SCHEDULE_TIMEZONE,
		gmt: DEFAULT_SCHEDULE_TIMEZONE,
		z: DEFAULT_SCHEDULE_TIMEZONE,
	} satisfies Record<string, string>),
);

const MODERN_ZONES: readonly string[] = [
	"Asia/Kolkata",
	"Europe/Kyiv",
	"Asia/Ho_Chi_Minh",
	"America/Argentina/Buenos_Aires",
];

const POPULAR_CITIES: readonly string[] = [
	"Berlin",
	"London",
	"New York",
	"Los Angeles",
	"Chicago",
	"Denver",
	"Toronto",
	"Paris",
	"Amsterdam",
	"Madrid",
	"Stockholm",
	"Tokyo",
	"Singapore",
	"Sydney",
	"Kolkata",
	"Sao Paulo",
];

interface ZoneIndex {
	byCity: Map<string, string>;
	byId: Map<string, string>;
	cities: string[];
}

let zoneIndex: ZoneIndex | null = null;

function cityOf(zone: string): string {
	return (zone.split("/").at(-1) ?? zone).replaceAll("_", " ");
}

function zones(): ZoneIndex {
	if (zoneIndex) {
		return zoneIndex;
	}
	const known = Intl.supportedValuesOf("timeZone");
	const byCity = new Map<string, string>();
	const byId = new Map<string, string>();
	const modern = MODERN_ZONES.filter(isValidTimeZone);
	for (const zone of [...modern, ...known]) {
		byId.set(zone.toLowerCase(), zone);
		if (zone.includes("/") && !zone.startsWith("Etc/")) {
			const city = cityOf(zone).toLowerCase();
			if (!byCity.has(city)) {
				byCity.set(city, zone);
			}
		}
	}
	const popular = POPULAR_CITIES.filter((city) =>
		byCity.has(city.toLowerCase()),
	);
	const rest = [...byCity.values()]
		.map(cityOf)
		.filter((city) => !popular.includes(city))
		.sort((a, b) => a.localeCompare(b));
	zoneIndex = { byCity, byId, cities: [...popular, ...rest] };
	return zoneIndex;
}

function titleZone(raw: string): string {
	return raw
		.split("/")
		.map((segment) =>
			segment
				.split("_")
				.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
				.join("_"),
		)
		.join("/");
}

function zoneFromId(raw: string): string | null {
	const lower = raw.toLowerCase();
	const alias = ZONE_ALIASES.get(lower);
	if (alias) {
		return alias;
	}
	if (!lower.includes("/")) {
		return null;
	}
	const known = zones().byId.get(lower);
	if (known) {
		return known;
	}
	const titled = titleZone(lower);
	return isValidTimeZone(titled) ? titled : null;
}

function zoneFromCity(words: readonly string[]): string | null {
	return zones().byCity.get(words.join(" ").toLowerCase()) ?? null;
}

/** The word a zone reads as in schedule text: "Berlin", "UTC" or the IANA id. */
export function scheduleZoneWord(zone: string): string {
	if (zone === DEFAULT_SCHEDULE_TIMEZONE) {
		return zone;
	}
	const city = cityOf(zone);
	return zoneFromCity([city]) === zone ? city : zone;
}

function offsetName(zone: string, now: Date): string {
	const part = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		timeZoneName: "shortOffset",
	})
		.formatToParts(now)
		.find((entry) => entry.type === "timeZoneName")?.value;
	const offset = (part ?? "GMT").replace(/^GMT/, "");
	return `UTC${offset || "+0"}`;
}

/** The zone and its offset on `now`, as a hover label: "Europe/Berlin, UTC+1". */
export function zoneOffsetLabel(zone: string, now = new Date()): string {
	return zone === DEFAULT_SCHEDULE_TIMEZONE
		? zone
		: `${zone}, ${offsetName(zone, now)}`;
}

function wordsOf(text: string, pattern: RegExp): Word[] {
	return [...text.matchAll(pattern)].map((match) => ({
		text: match[0],
		lower: match[0].toLowerCase(),
		from: match.index,
		to: match.index + match[0].length,
	}));
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function clockText(hour: number, minute: number): string {
	return `${pad(hour)}:${pad(minute)}`;
}

function ordinal(day: number): string {
	const teen = day % 100 >= 11 && day % 100 <= 13;
	const suffix = teen ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
	return `${day}${suffix}`;
}

function capital(word: string): string {
	return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

function joinWords(words: readonly string[]): string {
	if (words.length <= 1) {
		return words[0] ?? "";
	}
	return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function countOf(word: string | undefined): number | null {
	if (word === undefined) {
		return null;
	}
	if (/^\d{1,4}$/.test(word)) {
		return Number(word);
	}
	return NUMBER_WORDS.get(word) ?? null;
}

interface TimeRead {
	hour: number;
	minute: number;
	valid: boolean;
	used: number;
}

function readTime(words: readonly Word[], at: number): TimeRead | null {
	const word = words[at]?.lower;
	if (word === undefined) {
		return null;
	}
	if (word === "noon") {
		return { hour: 12, minute: 0, valid: true, used: 1 };
	}
	if (word === "midnight") {
		return { hour: 0, minute: 0, valid: true, used: 1 };
	}
	const match = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/.exec(word);
	if (!match) {
		return null;
	}
	let used = 1;
	let meridiem = match[3]?.charAt(0);
	const next = words[at + 1]?.lower;
	if (!meridiem && next && /^(am|pm|a\.m\.|p\.m\.)$/.test(next)) {
		meridiem = next.charAt(0);
		used = 2;
	}
	let hour = Number(match[1]);
	const minute = Number(match[2] ?? "0");
	let valid = minute <= 59;
	if (meridiem) {
		valid = valid && hour >= 1 && hour <= 12;
		hour = (hour % 12) + (meridiem === "p" ? 12 : 0);
	} else {
		valid = valid && hour <= 23;
	}
	return { hour, minute, valid, used };
}

function readDay(word: string | undefined): number | null {
	const match = word ? /^(\d{1,2})(st|nd|rd|th)?$/.exec(word) : null;
	return match ? Number(match[1]) : null;
}

const SKIP_WORDS = new Set([
	"shorter",
	"short",
	"those",
	"the",
	"months",
	"month",
]);

function span(from: Word, to: Word): Span {
	return { from: from.from, to: to.to };
}

class Reader {
	readonly read: Read = {};
	private at = 0;
	private everyAt = -1;

	constructor(private readonly words: readonly Word[]) {}

	private word(offset = 0): Word | undefined {
		return this.words[this.at + offset];
	}

	private lower(offset = 0): string | undefined {
		return this.word(offset)?.lower;
	}

	private take(count: number): Span {
		const first = this.word();
		const last = this.word(count - 1);
		this.at += count;
		return first && last ? span(first, last) : { from: 0, to: 0 };
	}

	run(): Read {
		while (this.at < this.words.length && !this.read.unknown) {
			if (!this.step()) {
				const word =
					this.lower() === "in" && this.word(1) ? this.word(1) : this.word();
				if (word) {
					this.read.unknown = { from: word.from, to: word.to };
				}
			}
		}
		return this.read;
	}

	private step(): boolean {
		const word = this.lower() ?? "";
		const afterEvery = this.at === this.everyAt + 1 && this.everyAt >= 0;
		if ((word === "every" || word === "each") && !this.read.every) {
			this.everyAt = this.at;
			this.read.every = this.take(1);
			if (this.at >= this.words.length) {
				this.read.everyDangling = this.read.every;
			}
			return this.everyFollowerOk();
		}
		if (word === "and" || word === "&") {
			this.at += 1;
			return true;
		}
		if (word === "skip" || word === "skipping") {
			return this.skip();
		}
		if (word === "at") {
			return this.atPhrase();
		}
		if (this.count(afterEvery)) {
			return true;
		}
		if (this.unit()) {
			return true;
		}
		if (this.keyword(afterEvery)) {
			return true;
		}
		if (this.weekdays()) {
			return true;
		}
		if (this.monthDay()) {
			return true;
		}
		if (this.monthOf()) {
			return true;
		}
		if (this.minute()) {
			return true;
		}
		if (this.time()) {
			return true;
		}
		return this.zone();
	}

	private everyFollowerOk(): boolean {
		const next = this.lower();
		if (next === undefined) {
			return true;
		}
		const compact = /^\d+[a-z]+$/.test(next);
		const ok =
			countOf(next) !== null ||
			compact ||
			SINGLE_UNIT.has(next) ||
			WEEKDAY_NAMES.has(next) ||
			next === "weekday" ||
			next === "weekend" ||
			next === "weekdays" ||
			next === "weekends";
		if (!ok) {
			const word = this.word();
			if (word) {
				this.read.unknown = { from: word.from, to: word.to };
			}
		}
		return true;
	}

	private skip(): boolean {
		let used = 1;
		while (SKIP_WORDS.has(this.lower(used) ?? "")) {
			used += 1;
		}
		if (this.read.skip) {
			return false;
		}
		this.read.skip = this.take(used);
		return true;
	}

	private atPhrase(): boolean {
		const next = this.lower(1);
		if (next === undefined) {
			this.read.atDangling = this.take(1);
			return true;
		}
		if (next === "minute" || /^:\d{1,2}$/.test(next)) {
			return this.minute(1);
		}
		return this.time(1);
	}

	private count(afterEvery: boolean): boolean {
		const word = this.lower();
		if (word === undefined || this.read.interval) {
			return false;
		}
		const compact = /^(\d{1,4})([a-z]+)$/.exec(word);
		if (compact) {
			const suffix = compact[2] ?? "";
			const unit = COMPACT_UNITS.get(suffix) ?? UNIT_WORDS.get(suffix);
			if (!unit) {
				return false;
			}
			const from = this.word();
			this.setInterval(
				Number(compact[1]),
				unit,
				this.take(1),
				{
					from: from?.from ?? 0,
					to: (from?.from ?? 0) + (compact[1]?.length ?? 0),
				},
				compact[2] ?? "",
			);
			return true;
		}
		const n = countOf(word);
		if (n === null) {
			return false;
		}
		const unitWord = this.lower(1) ?? "";
		const unit = UNIT_WORDS.get(unitWord);
		const countWord = this.word();
		if (unit && countWord) {
			this.setInterval(
				n,
				unit,
				this.take(2),
				span(countWord, countWord),
				unitWord,
			);
			return true;
		}
		if (afterEvery && countWord) {
			this.read.interval = {
				...this.take(1),
				n,
				unit: null,
				count: span(countWord, countWord),
				unitWord: "",
			};
			return true;
		}
		return false;
	}

	private setInterval(
		n: number,
		unit: IntervalUnit,
		where: Span,
		count: Span | null,
		unitWord: string,
	) {
		this.read.interval = { ...where, n, unit, count, unitWord };
	}

	private unit(): boolean {
		const word = this.lower() ?? "";
		const kind = SINGLE_UNIT.get(word);
		if (!kind) {
			return false;
		}
		if (kind === "minute") {
			if (this.read.interval) {
				return false;
			}
			this.setInterval(1, "minutes", this.take(1), null, word);
			return true;
		}
		return this.setBase(kind, [], this.take(1));
	}

	private setBase(kind: BaseKind, days: number[], where: Span): boolean {
		if (this.read.base) {
			return false;
		}
		this.read.base = { ...where, kind, days };
		return true;
	}

	private keyword(afterEvery: boolean): boolean {
		let used = 0;
		let kind: BaseKind | undefined;
		const word = this.lower() ?? "";
		const onWeekdays = word === "on" && KEYWORDS.get(this.lower(1) ?? "");
		const start = onWeekdays ? 1 : 0;
		const first = this.lower(start) ?? "";
		if (
			(first === "monday" || first === "mon") &&
			(this.lower(start + 1) === "to" || this.lower(start + 1) === "through") &&
			(this.lower(start + 2) === "friday" || this.lower(start + 2) === "fri")
		) {
			kind = "weekdays";
			used = start + 3;
		} else if (KEYWORDS.has(first)) {
			kind = KEYWORDS.get(first);
			used = start + 1;
		}
		if (!kind) {
			return false;
		}
		const plain = kind === "weekdays" || kind === "weekends";
		if (afterEvery && !plain) {
			return false;
		}
		return this.setBase(kind, [], this.take(used));
	}

	private weekdays(): boolean {
		const start = this.lower() === "on" ? 1 : 0;
		if (WEEKDAY_NAMES.get(this.lower(start) ?? "") === undefined) {
			return false;
		}
		const days: number[] = [];
		let used = start;
		while (true) {
			const day = WEEKDAY_NAMES.get(this.lower(used) ?? "");
			if (day !== undefined) {
				days.push(day);
				used += 1;
				continue;
			}
			const joiner = this.lower(used);
			if (
				(joiner === "and" || joiner === "&") &&
				WEEKDAY_NAMES.get(this.lower(used + 1) ?? "") !== undefined
			) {
				used += 1;
				continue;
			}
			break;
		}
		const unique = [...new Set(days)].sort((a, b) => a - b);
		const base = this.read.base;
		if (
			base &&
			(base.kind === "weekly" || base.kind === "week") &&
			base.days.length === 0
		) {
			base.kind = "weekly";
			base.days = unique;
			this.read.weekdaySpan = this.take(used);
			return true;
		}
		return this.setBase("weekly", unique, this.take(used));
	}

	private monthDay(): boolean {
		let used = 0;
		if (this.lower(used) === "on") {
			used += 1;
		}
		let value: number | null = null;
		if (this.lower(used) === "the") {
			value = readDay(this.lower(used + 1));
			used += 2;
		} else if (this.lower(used) === "day") {
			value = countOf(this.lower(used + 1));
			used += 2;
		} else if (/(st|nd|rd|th)$/.test(this.lower(used) ?? "")) {
			value = readDay(this.lower(used));
			used += 1;
		}
		if (value === null) {
			return false;
		}
		const where = this.take(used);
		const day = this.read.day;
		if (day) {
			day.to = where.to;
			day.values.push(value);
			day.value = Math.max(day.value, value);
			return true;
		}
		this.read.day = { ...where, value, values: [value] };
		return true;
	}

	private monthOf(): boolean {
		const of = this.lower() === "of";
		const which = this.lower(1);
		const month = this.lower(2);
		if (
			!of ||
			!(which === "the" || which === "every" || which === "each") ||
			month !== "month"
		) {
			return false;
		}
		if (this.read.base) {
			return false;
		}
		this.read.monthOf = this.take(3);
		this.read.base = { ...this.read.monthOf, kind: "monthly", days: [] };
		return true;
	}

	private minute(skip = 0): boolean {
		const word = this.lower(skip) ?? "";
		let value: number | null = null;
		let used = skip;
		const colon = /^:(\d{1,2})$/.exec(word);
		if (colon) {
			value = Number(colon[1]);
			used += 1;
		} else if (word === "minute") {
			value = countOf(this.lower(skip + 1));
			used += 2;
		}
		if (value === null || value > 59 || this.read.minute) {
			return false;
		}
		this.read.minute = { ...this.take(used), value };
		return true;
	}

	private time(skip = 0): boolean {
		const read = readTime(this.words, this.at + skip);
		if (!read) {
			return false;
		}
		const where = this.take(skip + read.used);
		const clock = { hour: read.hour, minute: read.minute, valid: read.valid };
		const time = this.read.time;
		if (time) {
			time.to = where.to;
			time.times.push(clock);
			time.valid = time.valid && clock.valid;
			return true;
		}
		this.read.time = { ...where, ...clock, times: [clock] };
		return true;
	}

	private zone(): boolean {
		if (this.read.zone) {
			return false;
		}
		const start = this.lower() === "in" ? 1 : 0;
		for (let size = 3; size >= 1; size--) {
			const words = this.words
				.slice(this.at + start, this.at + start + size)
				.map((word) => word.lower);
			if (words.length < size) {
				continue;
			}
			const id =
				size === 1
					? (zoneFromId(words[0] ?? "") ?? zoneFromCity(words))
					: zoneFromCity(words);
			if (id) {
				const used =
					start + size + (this.lower(start + size) === "time" ? 1 : 0);
				this.read.zone = { ...this.take(used), id };
				return true;
			}
		}
		return false;
	}
}

function tidy(text: string): string {
	return text
		.replace(/\s+,/g, ",")
		.replace(/,(\s*,)+/g, ",")
		.replace(/\s{2,}/g, " ")
		.replace(/^[\s,]+|[\s,]+$/g, "");
}

function replace(text: string, where: Span, insert: string): string {
	return tidy(`${text.slice(0, where.from)}${insert}${text.slice(where.to)}`);
}

function withTime(text: string, read: Read): string {
	return read.time ? text : `${text} at ${DEFAULT_TIME}`;
}

const UNIT_LABEL = {
	minutes: ["minute", "minutes"],
	hours: ["hour", "hours"],
	days: ["day", "days"],
	weeks: ["week", "weeks"],
	months: ["month", "months"],
} as const satisfies Record<IntervalUnit, readonly [string, string]>;

function unitText(n: number, unit: IntervalUnit): string {
	const [one, many] = UNIT_LABEL[unit];
	return `${n} ${n === 1 ? one : many}`;
}

function weekdayName(day: number): string {
	return capital(WEEKDAYS[day] ?? "");
}

function baseLabel(base: NonNullable<Read["base"]>): string {
	switch (base.kind) {
		case "hourly":
			return "Every hour";
		case "daily":
			return "Every day";
		case "weekdays":
			return "Monday to Friday";
		case "weekends":
			return "Saturday and Sunday";
		case "week":
			return "Every week";
		case "monthly":
			return "Every month";
		default:
			return base.days.length > 0
				? `Every ${joinWords(base.days.map(weekdayName))}`
				: "Every week";
	}
}

interface Tones {
	[key: string]: ScheduleTokenTone;
}

function tokensOf(
	text: string,
	read: Read,
	tones: Tones,
	now: Date,
): ScheduleToken[] {
	const tokens: ScheduleToken[] = [];
	const push = (
		key: string,
		where: Span | undefined,
		kind: ScheduleTokenKind,
		label: string,
	) => {
		if (!where) {
			return;
		}
		tokens.push({
			from: where.from,
			to: where.to,
			text: text.slice(where.from, where.to),
			kind,
			label,
			tone: tones[key] ?? "ok",
		});
	};
	const { every, base, interval } = read;
	const mergeEvery =
		every &&
		base &&
		!interval &&
		base.from > every.to &&
		text.slice(every.to, base.from).trim() === "";
	if (every && !mergeEvery) {
		push("every", every, "cadence", "Repeats");
	}
	if (interval) {
		push(
			"interval",
			interval,
			"interval",
			interval.unit
				? `Every ${unitText(interval.n, interval.unit)}`
				: "Repeats",
		);
	}
	if (base) {
		push(
			"base",
			mergeEvery && every ? { from: every.from, to: base.to } : base,
			"cadence",
			baseLabel(base),
		);
	}
	push(
		"weekdays",
		read.weekdaySpan,
		"cadence",
		baseLabel(base ?? { from: 0, to: 0, kind: "weekly", days: [] }),
	);
	if (read.day) {
		push(
			"day",
			read.day,
			"day",
			`The ${joinWords(monthDays(read.day).map(ordinal))} of the month`,
		);
	}
	if (read.time) {
		push(
			"time",
			read.time,
			"time",
			read.time.valid
				? joinWords(
						clocksOf(read.time).map((clock) =>
							clockText(clock.hour, clock.minute),
						),
					)
				: "Not a time",
		);
	}
	push("at", read.atDangling, "time", "At");
	if (read.minute) {
		push("minute", read.minute, "minute", `At :${pad(read.minute.value)}`);
	}
	if (read.zone) {
		push("zone", read.zone, "zone", zoneOffsetLabel(read.zone.id, now));
	}
	if (read.skip) {
		push("skip", read.skip, "skip", "Skips months without that day");
	}
	if (read.unknown) {
		push("unknown", read.unknown, "unknown", "Not understood");
	}
	return tokens.sort((a, b) => a.from - b.from);
}

type Outcome =
	| { ok: true; every: ScheduleCadence; timezone: string | undefined }
	| {
			ok: false;
			reason: ScheduleTextProblem;
			message: string;
			fixes: ScheduleFix[];
			tones?: Tones;
	  };

function fail(
	reason: ScheduleTextProblem,
	message: string,
	fixes: ScheduleFix[] = [],
	tones: Tones = {},
): Outcome {
	return { ok: false, reason, message, fixes, tones };
}

const MINUTE_STEPS = [5, 6, 10, 12, 15, 20, 30];

function nearestStep(n: number): number {
	return MINUTE_STEPS.reduce((best, step) =>
		Math.abs(step - n) < Math.abs(best - n) ? step : best,
	);
}

function floorFix(
	text: string,
	interval: NonNullable<Read["interval"]>,
): ScheduleFix {
	const singular =
		interval.unitWord === "minute" || interval.unitWord === "min";
	const unit = singular ? `${interval.unitWord}s` : interval.unitWord;
	const insert = `${SCHEDULE_TICK_MINUTES} ${unit}`;
	return {
		label: `Use ${SCHEDULE_TICK_MINUTES} minutes`,
		text: replace(text, interval, insert),
	};
}

function resolveInterval(text: string, read: Read): Outcome | null {
	const interval = read.interval;
	if (!interval) {
		return null;
	}
	const tones: Tones = { interval: "fail" };
	if (read.base || read.day) {
		return fail("invalid", "Use an interval or a day, not both.", [], tones);
	}
	if (interval.unit === null) {
		return fail("incomplete", "Add a unit, like every 5 days.", [
			{
				label: "Use days",
				text: replace(text, interval, `${interval.n} days`),
			},
		]);
	}
	if (interval.unit === "months") {
		if (interval.n === 1) {
			return null;
		}
		const weeks = Math.round((interval.n * 30) / 7);
		return fail(
			"unstorable",
			"An interval counts hours, days or weeks.",
			[
				{
					label: `Use ${weeks} weeks`,
					text: replace(text, interval, `${weeks} weeks`),
				},
			],
			tones,
		);
	}
	let { n, unit } = interval;
	if (unit === "minutes") {
		if (n < SCHEDULE_TICK_MINUTES) {
			return fail(
				"floor",
				`Runs must be at least ${SCHEDULE_TICK_MINUTES} minutes apart.`,
				[floorFix(text, interval)],
				tones,
			);
		}
		if (n < 60 || n % 60 !== 0) {
			if (read.time || read.minute) {
				return dropTime(text, read, []);
			}
			if (n > 60 || 60 % n !== 0) {
				const step = nearestStep(n);
				return fail(
					"unstorable",
					"Minutes must divide the hour evenly, like 10, 15 or 30.",
					[
						{
							label: `Use ${step} minutes`,
							text: replace(text, interval, `${step} minutes`),
						},
					],
					tones,
				);
			}
			return {
				ok: true,
				every: { cron: `*/${n} * * * *` },
				timezone: read.zone?.id,
			};
		}
		n /= 60;
		unit = "hours";
	}
	const every = { n, unit };
	if (
		unit === "hours" &&
		read.minute &&
		!read.time &&
		!read.skip &&
		n > 1 &&
		n < 24 &&
		24 % n === 0
	) {
		return {
			ok: true,
			every: { cron: `${read.minute.value} */${n} * * *` },
			timezone: read.zone?.id,
		};
	}
	if (read.time || read.minute) {
		return dropTime(text, read, []);
	}
	if (read.zone) {
		return fail(
			"unstorable",
			"An interval counts from the last run, so it has no timezone.",
			[{ label: "Drop the timezone", text: replace(text, read.zone, "") }],
			{ zone: "fail" },
		);
	}
	if (read.skip) {
		return fail("invalid", "Only a day after the 28th skips months.", [], {
			skip: "fail",
		});
	}
	const unitMs = DURATION_UNIT_MS[unit];
	if (n < 1 || n * unitMs > MAX_SCHEDULE_EVERY_MS) {
		const max = Math.floor(MAX_SCHEDULE_EVERY_MS / unitMs);
		return fail(
			"invalid",
			"Runs must be at most 52 weeks apart.",
			[
				{
					label: `Use ${unitText(max, unit)}`,
					text: replace(text, interval, unitText(max, unit)),
				},
			],
			tones,
		);
	}
	return { ok: true, every, timezone: undefined };
}

function dropTime(text: string, read: Read, closer: ScheduleFix[]): Outcome {
	const where = read.time ?? read.minute;
	return fail(
		"unstorable",
		"An interval counts from the last run, so it has no time of day.",
		[
			...closer,
			...(where
				? [{ label: "Drop the time", text: replace(text, where, "") }]
				: []),
		],
		{ time: "fail", minute: "fail" },
	);
}

const MISSING_MONTH_DAY = new Map<number, string>([
	[29, "February has no 29th most years."],
	[30, "February has no 30th."],
	[31, "Five months have no 31st."],
]);

function resolveClock(text: string, read: Read): Outcome {
	const zone = read.zone?.id;
	let base = read.base;
	if (!base && (read.day || read.interval?.unit === "months")) {
		base = { from: 0, to: 0, kind: "monthly", days: [] };
	}
	if (!base) {
		return fail(
			"incomplete",
			"Add how often, like every day.",
			read.time
				? [{ label: "Every day", text: `every day ${text.trim()}` }]
				: [],
		);
	}
	if (read.time && !read.time.valid) {
		return fail("invalid", "Use a time from 00:00 to 23:59.", [], {
			time: "fail",
		});
	}
	if (base.kind === "hourly") {
		if (read.time) {
			return fail(
				"unstorable",
				"An hourly schedule takes a minute, like at :15.",
				[
					{
						label: "Use :00",
						text: replace(text, read.time, "at :00"),
					},
				],
				{ time: "fail" },
			);
		}
		if (read.day) {
			return fail("invalid", "An hourly schedule runs every day.", [], {
				day: "fail",
			});
		}
		return {
			ok: true,
			every: { preset: "hourly", minute: read.minute?.value ?? 0 },
			timezone: zone,
		};
	}
	if (read.minute) {
		return fail("invalid", "A minute only fits an hourly schedule.", [], {
			minute: "fail",
		});
	}
	if (
		base.kind === "week" ||
		(base.kind === "weekly" && base.days.length === 0)
	) {
		const lead = read.every
			? { from: Math.min(read.every.from, base.from), to: base.to }
			: base;
		return fail("incomplete", "Add a day, like every monday.", [
			{
				label: "Every Monday",
				text: withTime(replace(text, lead, "every monday"), read),
			},
		]);
	}
	if (base.kind === "monthly") {
		if (!read.day) {
			return fail("incomplete", "Add a day, like on the 1st.", [
				{
					label: "On the 1st",
					text: withTime(`${tidy(text)} on the 1st`, read),
				},
			]);
		}
	} else if (read.day) {
		return fail(
			"invalid",
			"Pick a weekday or a day of the month, not both.",
			[],
			{ day: "fail" },
		);
	}
	const day = read.day;
	const days = day ? monthDays(day) : [];
	if (days.some((value) => value < 1 || value > 31)) {
		return fail("invalid", "A month has at most 31 days.", [], { day: "fail" });
	}
	if (day && day.value > 28 && !read.skip) {
		return fail(
			"ambiguous",
			MISSING_MONTH_DAY.get(day.value) ?? "",
			[
				{
					label: "Skip those months",
					text: `${withTime(tidy(text), read)}, skipping shorter months`,
				},
				{
					label: "Run on the 28th instead",
					text: withTime(replace(text, day, "on the 28th"), read),
				},
			],
			{ day: "warn" },
		);
	}
	if (read.skip && !(day && day.value > 28)) {
		return fail("invalid", "Only a day after the 28th skips months.", [], {
			skip: "fail",
		});
	}
	if (!read.time) {
		return fail(
			"incomplete",
			read.atDangling
				? "Add a time, like 09:00."
				: "Add a time, like at 09:00.",
			[
				{
					label: `At ${DEFAULT_TIME}`,
					text: read.atDangling
						? `${tidy(text)} ${DEFAULT_TIME}`
						: `${tidy(text)} at ${DEFAULT_TIME}`,
				},
			],
		);
	}
	const clocks = clocksOf(read.time);
	const [first] = clocks;
	if (clocks.length === 1 && days.length <= 1 && first) {
		const preset = presetFor(base, days[0], first);
		if (preset) {
			return { ok: true, every: preset, timezone: zone };
		}
	}
	const minutes = [...new Set(clocks.map((clock) => clock.minute))];
	const hours = [...new Set(clocks.map((clock) => clock.hour))];
	if (minutes.length * hours.length !== clocks.length) {
		return fail(
			"unstorable",
			"Times in one schedule share their minutes, like 09:00 and 17:00.",
			[],
			{ time: "fail" },
		);
	}
	const cron = `${minutes.join(",")} ${hours.join(",")} ${dayFields(base, days)}`;
	const checked = scheduleCronSchema.safeParse({ cron });
	if (!checked.success) {
		return fail(
			"invalid",
			cronMessage(
				checked.error.issues[0]?.message ?? "this cron does not parse",
			),
			[],
			{ time: "fail" },
		);
	}
	return { ok: true, every: { cron: checked.data.cron }, timezone: zone };
}

function monthDays(day: NonNullable<Read["day"]>): number[] {
	return [...new Set(day.values)].sort((a, b) => a - b);
}

function clocksOf(time: NonNullable<Read["time"]>): Clock[] {
	const seen = new Map<number, Clock>();
	for (const clock of time.times) {
		seen.set(clock.hour * 60 + clock.minute, clock);
	}
	return [...seen.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, clock]) => clock);
}

function presetFor(
	base: NonNullable<Read["base"]>,
	day: number | undefined,
	clock: Clock,
): ScheduleCadence | null {
	const at = clockText(clock.hour, clock.minute);
	switch (base.kind) {
		case "daily":
			return { preset: "daily", at };
		case "weekdays":
			return { preset: "weekdays", at };
		case "monthly": {
			const value = day ?? 1;
			return value > 28 ? null : { preset: "monthly", day: value, at };
		}
		case "weekly": {
			const [only] = base.days;
			const on = only === undefined ? undefined : WEEKDAYS[only];
			return base.days.length === 1 && on ? { preset: "weekly", on, at } : null;
		}
		default:
			return null;
	}
}

function dayFields(base: NonNullable<Read["base"]>, days: number[]): string {
	switch (base.kind) {
		case "weekdays":
			return "* * 1-5";
		case "weekends":
			return "* * 0,6";
		case "monthly":
			return `${days.length > 0 ? days.join(",") : "1"} * *`;
		case "weekly":
			return `* * ${base.days.join(",")}`;
		default:
			return "* * *";
	}
}

const CRON_NUMBER = /^[\d*][\d*,\-/]*$/;
const CRON_NAMED = /^[\da-z*][\da-z*,\-/]*$/i;

function cronFieldCount(words: readonly Word[]): number {
	const [first, second] = words;
	if (
		!(
			first &&
			second &&
			CRON_NUMBER.test(first.text) &&
			CRON_NUMBER.test(second.text)
		)
	) {
		return 0;
	}
	let count = 0;
	while (count < 5) {
		const word = words[count];
		const pattern = count < 3 ? CRON_NUMBER : CRON_NAMED;
		if (
			!(word && pattern.test(word.text)) ||
			(count >= 3 &&
				!/[\d*]/.test(word.text) &&
				!/^[a-z]{3}(-[a-z]{3})?(,[a-z]{3})*$/i.test(word.text))
		) {
			break;
		}
		count += 1;
	}
	return count;
}

function cronMessage(raw: string): string {
	return `${capital(raw)}.`;
}

function parseCronText(
	text: string,
	words: readonly Word[],
	size: number,
	now: Date,
): ScheduleTextParse {
	const fields = words.slice(0, size);
	const first = fields[0];
	const last = fields.at(-1);
	const cron = fields.map((field) => field.text).join(" ");
	const where = first && last ? span(first, last) : { from: 0, to: 0 };
	const rest = words.slice(size);
	let zone: (Span & { id: string }) | undefined;
	let unknown: Span | undefined;
	if (rest.length > 0) {
		const restReader = new Reader(rest);
		const read = restReader.run();
		const extra =
			read.every ||
			read.base ||
			read.interval ||
			read.time ||
			read.day ||
			read.minute ||
			read.skip;
		if (read.unknown || extra || !read.zone) {
			const bad = rest[0];
			unknown = read.unknown ?? (bad ? span(bad, bad) : undefined);
		} else {
			zone = read.zone;
		}
	}
	const readBack = cronText(cron);
	const label = readBack ? capital(readBack) : "Cron";
	const tokens = (tone: ScheduleTokenTone): ScheduleToken[] => {
		const list: ScheduleToken[] = [
			{
				...where,
				text: text.slice(where.from, where.to),
				kind: "cron",
				label,
				tone,
			},
		];
		if (zone) {
			list.push({
				from: zone.from,
				to: zone.to,
				text: text.slice(zone.from, zone.to),
				kind: "zone",
				label: zoneOffsetLabel(zone.id, now),
				tone: "ok",
			});
		}
		if (unknown) {
			list.push({
				...unknown,
				text: text.slice(unknown.from, unknown.to),
				kind: "unknown",
				label: "Not understood",
				tone: "fail",
			});
		}
		return list;
	};
	if (unknown) {
		return {
			ok: false,
			reason: "unknown",
			message: `Could not read "${text.slice(unknown.from, unknown.to)}".`,
			fixes: [],
			tokens: tokens("ok"),
		};
	}
	const parsed = scheduleCronSchema.safeParse({ cron });
	if (!parsed.success) {
		const raw = parsed.error.issues[0]?.message ?? "this cron does not parse";
		const floor = raw.includes(`at least ${SCHEDULE_TICK_MINUTES} minutes`);
		const minuteField = fields[0]?.text ?? "";
		const step = /^\*(\/(\d+))?$/.exec(minuteField);
		const fixes: ScheduleFix[] =
			floor && step && first
				? [
						{
							label: `Use ${SCHEDULE_TICK_MINUTES} minutes`,
							text: replace(
								text,
								span(first, first),
								`*/${SCHEDULE_TICK_MINUTES}`,
							),
						},
					]
				: [];
		return {
			ok: false,
			reason: floor ? "floor" : "invalid",
			message: cronMessage(raw),
			fixes,
			tokens: tokens("fail"),
		};
	}
	return {
		ok: true,
		every: { cron: parsed.data.cron },
		timezone: zone?.id,
		tokens: tokens("ok"),
	};
}

/**
 * Reads a schedule typed as words ("every monday at 7:00 berlin") or as a
 * five-field cron, into the stored schedule shape. Failures carry the reason,
 * a message, one-tap fixes as replacement text, and the words that were read.
 */
export function parseScheduleText(
	text: string,
	options: ScheduleTextOptions = {},
): ScheduleTextParse {
	const now = options.now ?? new Date();
	const result = readScheduleText(text, now);
	if (!result.ok || result.timezone === undefined) {
		return result;
	}
	const next = nextScheduleRun(
		{ every: result.every, timezone: result.timezone },
		{ after: now },
	);
	if (!next) {
		return result;
	}
	const zone = result.timezone;
	return {
		...result,
		tokens: result.tokens.map((token) =>
			token.kind === "zone"
				? { ...token, label: zoneOffsetLabel(zone, next) }
				: token,
		),
	};
}

function readScheduleText(text: string, now: Date): ScheduleTextParse {
	if (text.trim() === "") {
		return { ok: false, reason: "empty", message: "", fixes: [], tokens: [] };
	}
	const raw = wordsOf(text, /\S+/g);
	const cronFields = cronFieldCount(raw);
	if (cronFields > 0) {
		return parseCronText(text, raw, cronFields, now);
	}
	const read = new Reader(wordsOf(text, /[^\s,]+/g)).run();
	const outcome = resolve(text, read);
	const tokens = tokensOf(
		text,
		read,
		outcome.ok ? {} : (outcome.tones ?? {}),
		now,
	);
	if (outcome.ok) {
		return {
			ok: true,
			every: outcome.every,
			timezone: outcome.timezone,
			tokens,
		};
	}
	return {
		ok: false,
		reason: outcome.reason,
		message: outcome.message,
		fixes: outcome.fixes,
		tokens,
	};
}

function resolve(text: string, read: Read): Outcome {
	if (read.unknown) {
		return fail(
			"unknown",
			`Could not read "${text.slice(read.unknown.from, read.unknown.to)}".`,
			[],
			{ unknown: "fail" },
		);
	}
	if (read.everyDangling && !read.base && !read.interval) {
		return fail("incomplete", "Add how often, like every day.");
	}
	return (
		resolveInterval(text, normalizeSingle(read)) ?? resolveClock(text, read)
	);
}

const SINGLE_INTERVAL_BASE = {
	hours: "hourly",
	days: "daily",
	weeks: "week",
	months: "monthly",
} as const satisfies Partial<Record<IntervalUnit, BaseKind>>;

function normalizeSingle(read: Read): Read {
	const interval = read.interval;
	if (!interval || interval.n !== 1 || interval.unit === null) {
		return read;
	}
	const kind = read.base?.kind;
	if (
		(interval.unit === "weeks" && kind === "weekly") ||
		(interval.unit === "months" && kind === "monthly")
	) {
		if (read.base && kind === "weekly" && !read.weekdaySpan) {
			read.weekdaySpan = { from: read.base.from, to: read.base.to };
			read.base.from = interval.from;
			read.base.to = interval.to;
		}
		read.interval = undefined;
		return read;
	}
	if (read.base) {
		return read;
	}
	if (interval.unit === "minutes") {
		return read;
	}
	read.base = {
		from: interval.from,
		to: interval.to,
		kind: SINGLE_INTERVAL_BASE[interval.unit],
		days: [],
	};
	read.interval = undefined;
	return read;
}

const LEGACY_SINGLE = {
	hours: "every 60 minutes",
	days: "every 24 hours",
	weeks: "every 7 days",
} as const satisfies Record<EveryUnit, string>;

type CronDays =
	| { kind: "daily" }
	| { kind: "weekly"; days: number[] }
	| { kind: "monthly"; days: number[] };

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

function cronDays(spec: CronSpec): CronDays | null {
	const runs = (day: number, weekday: number) => cronRunsOn(spec, day, weekday);
	const weekdays = WEEK_DAYS.filter((weekday) =>
		MONTH_DAYS.every((day) => runs(day, weekday)),
	);
	const byWeekday = WEEK_DAYS.every((weekday) =>
		MONTH_DAYS.every(
			(day) => runs(day, weekday) === weekdays.includes(weekday),
		),
	);
	if (byWeekday) {
		return weekdays.length === 7
			? { kind: "daily" }
			: { kind: "weekly", days: weekdays };
	}
	const days = MONTH_DAYS.filter((day) =>
		WEEK_DAYS.every((weekday) => runs(day, weekday)),
	);
	const byDay = MONTH_DAYS.every((day) =>
		WEEK_DAYS.every((weekday) => runs(day, weekday) === days.includes(day)),
	);
	return byDay ? { kind: "monthly", days } : null;
}

function evenStep(values: readonly number[], span: number): number | null {
	const [first, second] = values;
	if (first !== 0 || second === undefined) {
		return null;
	}
	const step = second - first;
	const even = values.every((value, index) => value === index * step);
	return even && span % step === 0 && values.length === span / step
		? step
		: null;
}

const MAX_CRON_TIMES = 4;

function weekOrder(day: number): number {
	return (day + 6) % 7;
}

function cronLead(days: CronDays): string | null {
	if (days.kind === "daily") {
		return "every day";
	}
	if (days.kind === "monthly") {
		return days.days.length === 0
			? null
			: `monthly on the ${joinWords(days.days.map(ordinal))}`;
	}
	const list = days.days.join(",");
	if (list === "1,2,3,4,5") {
		return "weekdays";
	}
	if (list === "0,6") {
		return "weekends";
	}
	const names = [...days.days]
		.sort((a, b) => weekOrder(a) - weekOrder(b))
		.map(weekdayName);
	return names.length === 0 ? null : `every ${joinWords(names)}`;
}

/**
 * Words for a cron in the field's own voice, before the round trip check:
 * "every Sunday at 08:00", "weekdays at 09:00", "every 15 minutes",
 * "every 2 hours at :30", "monthly on the 1st and 15th at 06:00".
 */
function cronPhrase(cron: string): string | null {
	const parsed = parseCron(cron);
	if (!parsed.ok || parsed.spec.months.length !== 12) {
		return null;
	}
	const { minutes, hours } = parsed.spec;
	const days = cronDays(parsed.spec);
	if (!days) {
		return null;
	}
	const daily = days.kind === "daily";
	const [minute] = minutes;
	if (hours.length === 24) {
		if (!daily) {
			return null;
		}
		if (minutes.length === 1 && minute !== undefined) {
			return minute === 0 ? "every hour" : `every hour at :${pad(minute)}`;
		}
		const step = evenStep(minutes, 60);
		return step ? `every ${step} minutes` : null;
	}
	const hourStep = evenStep(hours, 24);
	if (
		minutes.length === 1 &&
		minute !== undefined &&
		hourStep &&
		hours.length > 2
	) {
		return daily ? `every ${hourStep} hours at :${pad(minute)}` : null;
	}
	if (minutes.length * hours.length > MAX_CRON_TIMES) {
		return null;
	}
	const lead = cronLead(days);
	if (!lead) {
		return null;
	}
	const times = hours.flatMap((hour) =>
		minutes.map((value) => clockText(hour, value)),
	);
	const at = `${lead} at ${joinWords(times)}`;
	if (days.kind !== "monthly" || days.days.every((day) => day <= 28)) {
		return at;
	}
	return days.days.length === 1 ? `${at}, skipping shorter months` : null;
}

/**
 * The words a cron reads as on every surface, or null when no phrase reads
 * back as the same cron. Callers then show the cron itself.
 */
export function cronText(cron: string): string | null {
	const phrase = cronPhrase(cron);
	if (!phrase) {
		return null;
	}
	const back = readScheduleText(phrase, new Date(0));
	const backCron = back.ok ? cadenceCron(back.every) : null;
	return backCron !== null && sameCron(backCron, cron) ? phrase : null;
}

function cadenceText(every: ScheduleCadence): string {
	if (isScheduleInterval(every)) {
		if (every.n === 1) {
			return LEGACY_SINGLE[every.unit];
		}
		return `every ${unitText(every.n, every.unit)}`;
	}
	if ("preset" in every) {
		switch (every.preset) {
			case "hourly":
				return every.minute === 0
					? "every hour"
					: `every hour at :${pad(every.minute)}`;
			case "daily":
				return `every day at ${every.at}`;
			case "weekdays":
				return `weekdays at ${every.at}`;
			case "weekly":
				return `every ${capital(every.on)} at ${every.at}`;
			default:
				return `monthly on the ${ordinal(every.day)} at ${every.at}`;
		}
	}
	const cron = every.cron.trim();
	return cronText(cron) ?? cron;
}

/**
 * The canonical text for a stored schedule. Reading it back with
 * parseScheduleText gives the same schedule. Intervals carry no zone.
 */
export function scheduleText(schedule: {
	every: ScheduleCadence;
	timezone?: string | undefined;
}): string {
	const words = cadenceText(schedule.every);
	if (isScheduleInterval(schedule.every) || !schedule.timezone) {
		return words;
	}
	return `${words} in ${scheduleZoneWord(schedule.timezone)}`;
}

/**
 * The schedule as a list reads it back, mid-sentence: scheduleText, and a
 * clock schedule without a zone names the zone it runs in.
 */
export function scheduleWords(schedule: {
	every: ScheduleCadence;
	timezone?: string | undefined;
}): string {
	return scheduleText({
		every: schedule.every,
		timezone: isScheduleInterval(schedule.every)
			? undefined
			: (schedule.timezone ?? DEFAULT_SCHEDULE_TIMEZONE),
	});
}

/**
 * The schedule as every surface reads it back: the canvas, the editor field,
 * the CLI and MCP. It is scheduleWords, starting with a capital.
 */
export function describeSchedule(schedule: {
	every: ScheduleCadence;
	timezone?: string | undefined;
}): string {
	return capital(scheduleWords(schedule));
}

const VOCABULARY = [
	"every",
	...WEEKDAYS,
	"weekdays",
	"weekends",
	"minutes",
	"hours",
	"days",
	"weeks",
	"month",
	"monthly",
	"daily",
	"hourly",
	"weekly",
	"noon",
	"midnight",
];

const TAILS = [
	"",
	` at ${DEFAULT_TIME}`,
	` ${DEFAULT_TIME}`,
	":00",
	" days",
	" minutes",
	` on the 1st at ${DEFAULT_TIME}`,
	" 5 days",
];

function tailFor(base: string, tail: string): string {
	return /\s$/.test(base) ? tail.trimStart() : tail;
}

/**
 * The rest of the phrase to show as ghost text after `text`, or null when
 * the text already reads as a schedule or no completion makes it one.
 */
export function completeScheduleText(text: string): string | null {
	if (text.trim() === "" || parseScheduleText(text).ok) {
		return null;
	}
	const partial = /(\S*)$/.exec(text)?.[1] ?? "";
	const lowerPartial = partial.toLowerCase();
	const bases: string[] = [];
	if (/^[a-z]+$/i.test(partial)) {
		for (const word of VOCABULARY) {
			if (word.startsWith(lowerPartial) && word !== lowerPartial) {
				bases.push(text + word.slice(partial.length));
			}
		}
	}
	const words = text.trimEnd().split(/\s+/);
	const cityBases: string[] = [];
	if (partial !== "" && /^[a-z]/i.test(partial)) {
		for (let size = 1; size <= 3 && size <= words.length; size++) {
			const prefix = words.slice(-size).join(" ").toLowerCase();
			for (const city of zones().cities) {
				if (
					city.toLowerCase().startsWith(prefix) &&
					city.length > prefix.length
				) {
					cityBases.push(text + city.slice(prefix.length));
				}
			}
		}
	}
	for (const base of bases) {
		for (const tail of TAILS) {
			const full = base + tailFor(base, tail);
			if (parseScheduleText(full).ok) {
				return full.slice(text.length);
			}
		}
	}
	for (const base of cityBases) {
		if (parseScheduleText(base).ok) {
			return base.slice(text.length);
		}
	}
	for (const tail of TAILS.slice(1)) {
		const full = text + tailFor(text, tail);
		if (parseScheduleText(full).ok) {
			return full.slice(text.length);
		}
	}
	return null;
}
