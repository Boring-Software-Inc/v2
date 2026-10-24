import {
	isScheduleInterval,
	isScheduleTrigger,
	nextScheduleRun,
	parseScheduleText,
	type ScheduleCadence,
	type ScheduleTextParse,
	type ScheduleTiming,
	sameScheduleTiming,
	scheduleCountsFrom,
	type WorkflowNode,
} from "@tripwire/contracts";
import { zoneOffsetName } from "#/lib/timezones";

export function isClockCadence(cadence: ScheduleCadence | undefined): boolean {
	return cadence !== undefined && !isScheduleInterval(cadence);
}

export interface InvalidScheduleDraft {
	nodeId: string;
	message: string;
}

export function invalidScheduleDrafts(
	drafts: ReadonlyMap<string, string>,
	nodes: readonly WorkflowNode[],
): InvalidScheduleDraft[] {
	return nodes.flatMap((node) => {
		const text = drafts.get(node.id);
		if (text === undefined || !isScheduleTrigger(node)) {
			return [];
		}
		const parsed = parseScheduleText(text);
		if (parsed.ok || parsed.reason === "empty") {
			return [];
		}
		return [{ nodeId: node.id, message: parsed.message }];
	});
}

export function formatNextRun(instant: Date, zone: string): string {
	const date = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		weekday: "short",
		month: "short",
		day: "numeric",
	}).format(instant);
	const time = new Intl.DateTimeFormat("en-GB", {
		timeZone: zone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(instant);
	return `${date}, ${time} ${zoneOffsetName(instant, zone)}`;
}

export interface SavedScheduleTiming {
	enabled: boolean;
	saved: ScheduleTiming | null;
	lastTickAt: Date | null;
}

export function editorNextRun(
	schedule: ScheduleTiming,
	timing: SavedScheduleTiming & { now: Date },
): Date | null {
	return nextScheduleRun(schedule, {
		after: timing.now,
		lastTickAt: scheduleCountsFrom({ ...timing, current: schedule }),
	});
}

export interface TypedSchedule {
	every: ScheduleCadence | undefined;
	timezone: string | undefined;
}

export function committedSchedule(
	saved: ScheduleTiming | null,
	typed: TypedSchedule,
): TypedSchedule {
	const timing = typed.every
		? { every: typed.every, timezone: typed.timezone }
		: null;
	return saved && sameScheduleTiming(saved, timing)
		? { every: saved.every, timezone: saved.timezone }
		: typed;
}

export function typedScheduleCommit(
	text: string,
	context: {
		saved: ScheduleTiming | null;
		current: TypedSchedule;
		newZone: string | undefined;
	},
): TypedSchedule | null {
	const result = parseScheduleText(text);
	if (result.ok) {
		return committedSchedule(context.saved, {
			every: result.every,
			timezone:
				result.timezone ??
				(isClockCadence(result.every)
					? (context.current.timezone ?? context.newZone)
					: undefined),
		});
	}
	return result.reason === "empty"
		? { every: undefined, timezone: undefined }
		: null;
}

export function showsScheduleZone(
	text: string,
	parsed: ScheduleTextParse,
): boolean {
	if (text.trim() === "" || parsed.tokens.some((t) => t.kind === "zone")) {
		return false;
	}
	return parsed.ok
		? isClockCadence(parsed.every)
		: !parsed.tokens.some((token) => token.kind === "interval");
}
