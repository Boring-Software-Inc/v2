import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AnalyticsChart } from "#/components/analytics/analytics-chart";
import { AnalyticsEvents } from "#/components/analytics/analytics-events";
import { AnalyticsBodySkeleton } from "#/components/analytics/analytics-page-skeleton";
import {
	ChartAtRest,
	hourlyZeroRows,
} from "#/components/analytics/chart-at-rest";
import { Icon, TrendDown, TrendUp } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import {
	type AnalyticsMetric,
	hoursAgo,
	moderationMetrics,
} from "#/lib/analytics";
import { analyticsActivityQueryOptions } from "#/lib/analytics-activity.query";
import { closestEventId } from "#/lib/analytics-events";
import { cn } from "#/lib/glaze/utils";
import { moderationStatsQueryOptions } from "#/lib/moderation.query";

const routeApi = getRouteApi("/$org/$repo/analytics");

function sentenceCase(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function AnalyticsPage() {
	const { org, repo } = routeApi.useParams();
	const moderationStats = useQuery(moderationStatsQueryOptions(org, repo));

	const metrics = useMemo(
		() => (moderationStats.data ? moderationMetrics(moderationStats.data) : []),
		[moderationStats.data],
	);

	const { metric: metricParam } = routeApi.useSearch();
	const [focused, setFocused] = useState(metricParam ?? "review");
	const [committedIndex, setCommittedIndex] = useState<number | null>(null);

	const focusedMetric = useMemo(
		() => metrics.find((m) => m.key === focused) ?? metrics[0],
		[metrics, focused],
	);

	const activity = useQuery(
		analyticsActivityQueryOptions(org, repo, focusedMetric?.key ?? "pending"),
	);
	const events = activity.data ?? [];

	const loading = moderationStats.isLoading;
	const hasData =
		metrics.some((m) => m.series.some((v) => v > 0)) || events.length > 0;

	const len = focusedMetric?.series.length ?? 0;
	const committedAt = committedIndex ?? Math.max(0, len - 1);
	const ago = hoursAgo(committedAt, len);
	const focusedEventId = closestEventId(events, ago, Date.now());

	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<h1 className="type-title">Analytics</h1>

					<SkeletonSwap
						fallback={<AnalyticsBodySkeleton />}
						label="Loading analytics"
						loading={loading}
					>
						{hasData && focusedMetric ? (
							<div className="flex flex-col gap-6">
								<SegmentedControl
									aria-label="Metric"
									onValueChange={setFocused}
									size="sm"
									value={focusedMetric.key}
								>
									{metrics.map((m) => (
										<SegmentedControlItem key={m.key} value={m.key}>
											{sentenceCase(m.label)}
										</SegmentedControlItem>
									))}
								</SegmentedControl>

								<AnalyticsChart
									description={
										<Readout
											ago={ago}
											metric={focusedMetric}
											value={focusedMetric.series[committedAt] ?? 0}
										/>
									}
									label={sentenceCase(focusedMetric.label)}
									onCommit={setCommittedIndex}
									series={focusedMetric.series}
									suffix={focusedMetric.suffix}
								/>

								<AnalyticsEvents events={events} focusedId={focusedEventId} />
							</div>
						) : (
							<ChartAtRest
								action={
									<Button
										nativeButton={false}
										render={
											<Link params={{ org, repo }} to="/$org/$repo/rules" />
										}
										size="sm"
										variant="ghost"
									>
										Open rules
									</Button>
								}
								config={{
									hour: { label: "Hour" },
									value: {
										label: sentenceCase(focusedMetric?.label ?? "activity"),
									},
								}}
								data={hourlyZeroRows("hour", ["value"])}
								label="No analytics yet"
								message="Charts appear here after Tripwire checks its first change request on this repo."
								type="line"
								unit="count"
								xKey="hour"
							/>
						)}
					</SkeletonSwap>
				</div>
			</div>
		</DashboardLayout>
	);
}

function Readout({
	metric,
	value,
	ago,
}: {
	metric: AnalyticsMetric;
	value: number;
	ago: number;
}) {
	return (
		<span className="flex flex-wrap items-baseline gap-x-2">
			<span className="type-heading text-text-1 tabular-nums">
				{value}
				{metric.suffix ?? ""}
			</span>
			<span>{ago === 0 ? "now" : `${ago}h ago`}</span>
			<Delta delta={metric.delta} goodDirection={metric.goodDirection} />
		</span>
	);
}

function Delta({
	delta,
	goodDirection,
}: {
	delta: number;
	goodDirection: AnalyticsMetric["goodDirection"];
}) {
	if (delta === 0) {
		return null;
	}
	const up = delta > 0;
	const good = goodDirection === "up" ? up : !up;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 type-label-sm tabular-nums",
				goodDirection === "neutral"
					? "text-text-2"
					: good
						? "text-ok-text"
						: "text-fail-text",
			)}
		>
			<Icon icon={up ? TrendUp : TrendDown} size={12} />
			{`${Math.abs(delta)} ${up ? "more" : "fewer"} than the 24 hours before`}
		</span>
	);
}
