import type { ModStats } from "#/lib/moderation.types";

export type GoodDirection = "up" | "down" | "neutral";

export type AnalyticsMetric = {
	key: string;
	label: string;
	series: number[];
	delta: number;
	goodDirection: GoodDirection;
	suffix?: string;
};

/** The same three metrics as Home, so the drill-down tells one story. */
export function moderationMetrics(stats: ModStats): AnalyticsMetric[] {
	return [
		{
			key: "review",
			label: "Sent to review",
			series: stats.sentToReview.series,
			delta: stats.sentToReview.delta,
			// more awaiting your decision is work piling up.
			goodDirection: "down",
		},
		{
			key: "blocked",
			label: "Blocked · 24h",
			series: stats.blocked.series,
			delta: stats.blocked.delta,
			// up = the gate working OR more attacks — genuinely ambiguous.
			goodDirection: "neutral",
		},
		{
			key: "passed",
			label: "Passed · 24h",
			series: stats.passed.series,
			delta: stats.passed.delta,
			goodDirection: "up",
		},
	];
}

/** A point's age in whole hours, mapped over a 24h window. */
export function hoursAgo(index: number, length: number): number {
	const span = 24;
	return Math.round(((length - 1 - index) / Math.max(length - 1, 1)) * span);
}
