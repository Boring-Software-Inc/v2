import {
	cadenceCron,
	isScheduleInterval,
	type ScheduleCadence,
	type SchedulePresetKind,
	type TimeOfDay,
} from "@tripwire/contracts";

export type CadenceKind = "interval" | SchedulePresetKind | "cron";

export const CADENCE_KIND_OPTIONS: readonly {
	value: CadenceKind;
	label: string;
}[] = [
	{ value: "hourly", label: "Hourly" },
	{ value: "daily", label: "Daily" },
	{ value: "weekdays", label: "Weekdays" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "interval", label: "Every few hours, days or weeks" },
	{ value: "cron", label: "Custom cron" },
];

const DEFAULT_AT: TimeOfDay = "09:00";
const DEFAULT_CRON = "0 9 * * *";

export function cadenceKind(cadence: ScheduleCadence): CadenceKind {
	if (isScheduleInterval(cadence)) {
		return "interval";
	}
	return "preset" in cadence ? cadence.preset : "cron";
}

function atOf(cadence: ScheduleCadence | undefined): TimeOfDay {
	return cadence && "at" in cadence ? cadence.at : DEFAULT_AT;
}

export function cadenceForKind(
	kind: CadenceKind,
	previous: ScheduleCadence | undefined,
): ScheduleCadence {
	if (previous && cadenceKind(previous) === kind) {
		return previous;
	}
	const at = atOf(previous);
	switch (kind) {
		case "interval":
			return { n: 12, unit: "hours" };
		case "hourly":
			return { preset: "hourly", minute: 0 };
		case "daily":
			return { preset: "daily", at };
		case "weekdays":
			return { preset: "weekdays", at };
		case "weekly":
			return { preset: "weekly", on: "monday", at };
		case "monthly":
			return { preset: "monthly", day: 1, at };
		case "cron":
			return { cron: (previous && cadenceCron(previous)) ?? DEFAULT_CRON };
		default:
			return { preset: "daily", at };
	}
}

export function isClockCadence(cadence: ScheduleCadence | undefined): boolean {
	return cadence !== undefined && !isScheduleInterval(cadence);
}
