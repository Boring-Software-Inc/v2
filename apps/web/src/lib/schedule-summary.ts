import type { ScheduleEvery, TriggerSchedule } from "@tripwire/contracts";

export const SCHEDULE_EVERY_LABEL = {
	"1h": "Every hour",
	"6h": "Every 6 hours",
	"12h": "Every 12 hours",
	"24h": "Every day",
} as const satisfies Record<ScheduleEvery, string>;

export function scheduleSummary(schedule: TriggerSchedule): string {
	const every = SCHEDULE_EVERY_LABEL[schedule.every];
	const days = schedule.match.inactiveDays;
	if (days === undefined) {
		return every;
	}
	return `${every}, inactive ${days} ${days === 1 ? "day" : "days"}`;
}
