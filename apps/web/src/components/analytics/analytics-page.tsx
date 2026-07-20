import { Analytics01Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import NumberFlow from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsChart } from "#/components/analytics/analytics-chart";
import { AnalyticsEvents } from "#/components/analytics/analytics-events";
import { AnalyticsMetricsSheet } from "#/components/analytics/analytics-metrics-sheet";
import {
	DitherStatCard,
	type GoodDirection,
} from "#/components/charts/dither-stat-card";
import { EmptyState } from "#/components/common/empty-state";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Button } from "#/components/ui/button";
import { hoursAgo, moderationMetrics } from "#/lib/analytics";
import { analyticsActivityQueryOptions } from "#/lib/analytics-activity.query";
import { closestEventId } from "#/lib/analytics-events";
import { moderationStatsQueryOptions } from "#/lib/moderation.query";
import { cn } from "#/lib/utils";

const routeApi = getRouteApi("/$org/$repo/analytics");

/**
 * REPO-level analytics at /:org/:repo/analytics (§8). The moderation store is
 * the only analytics source (§4) — one metric family, scoped to the URL's repo.
 */
export function AnalyticsPage() {
	const { org, repo } = routeApi.useParams();
	const moderationStats = useQuery(moderationStatsQueryOptions(org, repo));

	const metrics = useMemo(
		() => (moderationStats.data ? moderationMetrics(moderationStats.data) : []),
		[moderationStats.data],
	);

	// Deep links (?metric=blocked from the stat cards) seed the focus.
	const { metric: metricParam } = routeApi.useSearch();
	const [focused, setFocused] = useState(metricParam ?? "review");
	const [committedIndex, setCommittedIndex] = useState<number | null>(null);
	const [showMetrics, setShowMetrics] = useState(false);

	const focusedMetric = useMemo(
		() => metrics.find((m) => m.key === focused) ?? metrics[0],
		[metrics, focused],
	);

	// REAL activity — the runs + decisions behind the focused metric.
	const activity = useQuery(
		analyticsActivityQueryOptions(org, repo, focusedMetric?.key ?? "pending"),
	);
	const events = activity.data ?? [];

	// A freshly-armed repo with no evaluated change requests has metric families
	// but all-zero series — render an empty state, not a flat "broken-looking"
	// chart (§9). Real data ⇒ any non-zero point, or any activity behind it.
	const loading = moderationStats.isLoading;
	const hasData =
		metrics.some((m) => m.series.some((v) => v > 0)) || events.length > 0;

	const len = focusedMetric?.series.length ?? 0;
	// Committed point — what the readouts settle on (defaults to "now").
	const committedAt = committedIndex ?? Math.max(0, len - 1);
	const ago = hoursAgo(committedAt, len);
	const focusedEventId = closestEventId(events, ago, Date.now());

	// Opening the metrics sheet rides the scroll to the bottom (page slides up);
	// closing glides it back to wherever they opened it from.
	const scrollRef = useRef<HTMLDivElement>(null);
	const restoreTop = useRef(0);
	const prevOpen = useRef(false);
	useEffect(() => {
		const el = scrollRef.current;
		const opening = showMetrics && !prevOpen.current;
		const closing = !showMetrics && prevOpen.current;
		prevOpen.current = showMetrics;
		if (!el || (!opening && !closing)) return;

		if (opening) restoreTop.current = el.scrollTop;
		const target = opening ? () => el.scrollHeight : () => restoreTop.current;
		let raf = 0;
		let start = 0;
		const tick = (now: number) => {
			start ||= now;
			el.scrollTop = target();
			if (now - start < 520) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [showMetrics]);

	return (
		<DashboardLayout counts={{}}>
			<div className="relative flex h-full flex-col">
				<div
					ref={scrollRef}
					className="overflow-stable min-h-0 flex-1 overflow-y-auto px-6 py-8 md:px-8 md:py-10"
				>
					<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
						<Button variant="link" size="sm" asChild>
							<Link
								to="/$org/$repo/moderation"
								params={{ org, repo }}
								className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
							>
								<HugeiconsIcon
									icon={ArrowLeft01Icon}
									size={14}
									strokeWidth={2}
								/>
								back to moderation
							</Link>
						</Button>

						{loading ? (
							<p className="py-16 text-center text-muted-foreground text-sm">
								loading analytics…
							</p>
						) : hasData && focusedMetric ? (
							<>
								<header className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">
										{focusedMetric.label}
									</span>
									<div className="flex items-baseline gap-2">
										<NumberFlow
											value={focusedMetric.series[committedAt] ?? 0}
											suffix={focusedMetric.suffix}
											className="font-mono font-semibold text-4xl tracking-tight"
										/>
										<Delta
											delta={focusedMetric.delta}
											goodDirection={focusedMetric.goodDirection}
										/>
										<span className="font-mono text-[11px] text-muted-foreground tabular-nums">
											{ago === 0 ? "now" : `−${ago}h`}
										</span>
									</div>
								</header>

								{/* Chart — sits on the page surface and bleeds slightly past the
								    column on both sides, the dither dissolving out via a mask. */}
								<div
									className="h-56 overflow-hidden md:-mx-6"
									style={{
										maskImage:
											"linear-gradient(to right, transparent, #000 2.25rem, #000 calc(100% - 2.25rem), transparent)",
										WebkitMaskImage:
											"linear-gradient(to right, transparent, #000 2.25rem, #000 calc(100% - 2.25rem), transparent)",
									}}
								>
									<AnalyticsChart
										layoutId={`chart-moderation-${focusedMetric.key}`}
										series={focusedMetric.series}
										color={focusedMetric.color}
										committedIndex={committedIndex}
										suffix={focusedMetric.suffix}
										label={focusedMetric.label}
										onCommit={setCommittedIndex}
									/>
								</div>

								<AnalyticsEvents events={events} focusedId={focusedEventId} />
							</>
						) : (
							<EmptyState
								icon={Analytics01Icon}
								title="no analytics yet"
								description="once change requests are evaluated on this repo, their outcomes and trends show up here."
							/>
						)}
					</div>
				</div>

				{/* Clean gradient dissolve so content fades into the surface under
				    the tab instead of hard-cutting. Hidden while the sheet is open. */}
				{hasData && focusedMetric && !showMetrics ? (
					<div
						aria-hidden
						className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-card via-card/90 to-transparent"
					/>
				) : null}

				{/* Metrics — a full-width sheet that rises from the bottom. */}
				{hasData && focusedMetric ? (
					<AnalyticsMetricsSheet
						open={showMetrics}
						onOpenChange={setShowMetrics}
						metricCount={metrics.length}
					>
						<div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4">
							{metrics.map((m) => {
								const isFocused = m.key === focusedMetric.key;
								const cardValue =
									m.series[isFocused ? committedAt : m.series.length - 1] ?? 0;
								return (
									<DitherStatCard
										key={m.key}
										label={m.label}
										color={m.color}
										series={m.series}
										delta={m.delta}
										goodDirection={m.goodDirection}
										focused={isFocused}
										onClick={() => setFocused(m.key)}
										animate={false}
										value={String(cardValue)}
										valueNode={
											<NumberFlow
												value={cardValue}
												suffix={m.suffix}
												className="font-sans text-2xl text-foreground"
											/>
										}
									/>
								);
							})}
						</div>
					</AnalyticsMetricsSheet>
				) : null}
			</div>
		</DashboardLayout>
	);
}

function Delta({
	delta,
	goodDirection,
}: {
	delta: number;
	goodDirection: GoodDirection;
}) {
	if (delta === 0) {
		return null;
	}
	const up = delta > 0;
	const tone =
		goodDirection === "neutral"
			? "text-muted-foreground"
			: (goodDirection === "up" ? up : !up)
				? "text-emerald-500"
				: "text-red-500";
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 font-mono text-xs tabular-nums",
				tone,
			)}
		>
			<span className="text-[9px] leading-none">{up ? "▲" : "▼"}</span>
			{Math.abs(delta)}
		</span>
	);
}
