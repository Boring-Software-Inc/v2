import type { DurationUnit } from "@tripwire/contracts";

export const UNIT_LABEL = {
	hours: "Hours",
	days: "Days",
	weeks: "Weeks",
	months: "Months",
} as const satisfies Record<DurationUnit, string>;
