import { DEFAULT_SCHEDULE_TIMEZONE } from "@tripwire/contracts";

export type DisplayZoneSource = "account" | "org" | "device";

export interface DisplayZone {
	zone: string;
	source: DisplayZoneSource;
}

let zones: readonly string[] | null = null;

export function timezoneNames(): readonly string[] {
	if (!zones) {
		const known = Intl.supportedValuesOf("timeZone");
		zones = known.includes(DEFAULT_SCHEDULE_TIMEZONE)
			? known
			: [DEFAULT_SCHEDULE_TIMEZONE, ...known];
	}
	return zones;
}

export function deviceTimezone(): string {
	return (
		Intl.DateTimeFormat().resolvedOptions().timeZone ??
		DEFAULT_SCHEDULE_TIMEZONE
	);
}

export function resolveDisplayZone(input: {
	account: string | null | undefined;
	org: string | null | undefined;
	device: string;
}): DisplayZone {
	if (input.account) {
		return { zone: input.account, source: "account" };
	}
	if (input.org) {
		return { zone: input.org, source: "org" };
	}
	return { zone: input.device, source: "device" };
}

export function newScheduleTimezone(input: {
	org: string | null | undefined;
	account: string | null | undefined;
}): string | undefined {
	return input.org ?? input.account ?? undefined;
}

export function zoneOffsetName(instant: Date, zone: string): string {
	const part = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		timeZoneName: "short",
	})
		.formatToParts(instant)
		.find((entry) => entry.type === "timeZoneName");
	return part?.value ?? zone;
}

export function formatClockTime(instant: Date, zone: string): string {
	const clock = new Intl.DateTimeFormat("en-GB", {
		timeZone: zone,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(instant);
	return `${clock} ${zoneOffsetName(instant, zone)}`;
}

export function formatDateTime(instant: Date, zone: string): string {
	const date = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(instant);
	const time = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		hour: "numeric",
		minute: "2-digit",
	}).format(instant);
	return `${date}, ${time} ${zoneOffsetName(instant, zone)}`;
}

function dayParts(instant: Date, zone: string): { year: string; day: string } {
	const day = new Intl.DateTimeFormat("en-CA", {
		timeZone: zone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(instant);
	return { year: day.slice(0, 4), day };
}

export function formatShortTime(
	instant: Date,
	zone: string,
	now: Date = new Date(),
): string {
	const at = dayParts(instant, zone);
	const today = dayParts(now, zone);
	if (at.year !== today.year) {
		return formatDateTime(instant, zone);
	}
	const time = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		hour: "numeric",
		minute: "2-digit",
	}).format(instant);
	const zoneName = zoneOffsetName(instant, zone);
	if (at.day === today.day) {
		return `${time} ${zoneName}`;
	}
	const date = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		month: "short",
		day: "numeric",
	}).format(instant);
	return `${date}, ${time} ${zoneName}`;
}
