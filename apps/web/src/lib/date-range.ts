export interface DateRange {
	from: string;
	to: string;
}

const DAY = 24 * 60 * 60 * 1000;

export function isoDay(at: Date): string {
	return at.toISOString().slice(0, 10);
}

export function lastDays(days: number, now = new Date()): DateRange {
	return {
		from: isoDay(new Date(now.getTime() - (days - 1) * DAY)),
		to: isoDay(now),
	};
}

const SHORT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

export function rangeLabel(range: DateRange): string {
	const from = SHORT.format(new Date(`${range.from}T00:00:00Z`));
	const to = SHORT.format(new Date(`${range.to}T00:00:00Z`));
	return from === to ? from : `${from} to ${to}`;
}
