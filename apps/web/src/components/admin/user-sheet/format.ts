import { deviceTimezone, formatDateTime } from "#/lib/timezones";

export function formatStaffDateTime(value: Date | string): string {
	return formatDateTime(new Date(value), deviceTimezone());
}

export function formatStaffDate(value: Date | string): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(value));
}
