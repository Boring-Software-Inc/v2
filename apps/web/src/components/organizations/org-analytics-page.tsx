import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { DitherStatCard } from "#/components/charts/dither-stat-card";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";
import { orgAnalyticsQueryOptions } from "#/lib/org.query";

const route = getRouteApi("/$org/analytics");

/**
 * §8 — /:org/analytics is THIN: aggregate counts across the org's repos,
 * nothing more. Depth (charts, breakdowns) lives at /:org/:repo/analytics.
 */
export function OrgAnalyticsPage() {
	const { org } = route.useParams();
	const { data: summary, error } = useQuery(orgAnalyticsQueryOptions(org));

	if (error) {
		throw error;
	}

	return (
		<DashboardLayout counts={{}}>
			<div className="px-5 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
					<header className="flex flex-col gap-1.5">
						<h1 className="font-semibold text-2xl tracking-tight">Analytics</h1>
						<p className="text-muted-foreground text-sm">
							totals across this org's repos. per-repo analytics live on each
							repo's page.
						</p>
					</header>

					{summary ? (
						<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
							<DitherStatCard
								label="repos"
								value={String(summary.repos)}
								delta={0}
								series={[]}
								color="grey"
								goodDirection="neutral"
								delay={0}
							/>
							<DitherStatCard
								label="armed"
								value={String(summary.armedRepos)}
								delta={0}
								series={[]}
								color="green"
								goodDirection="neutral"
								delay={60}
							/>
							<DitherStatCard
								label="events (24h)"
								value={String(summary.events24h)}
								delta={trendDelta(summary.eventsSeries)}
								series={summary.eventsSeries}
								color="blue"
								goodDirection="neutral"
								delay={120}
							/>
							<DitherStatCard
								label="blocked (24h)"
								value={String(summary.blocked24h)}
								delta={trendDelta(summary.blockedSeries)}
								series={summary.blockedSeries}
								color="orange"
								goodDirection="neutral"
								delay={180}
							/>
							<DitherStatCard
								label="awaiting review"
								value={String(summary.pendingModeration)}
								delta={0}
								series={[]}
								color="purple"
								goodDirection="down"
								delay={240}
							/>
						</div>
					) : (
						<StatGridSkeleton />
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}

/** Trend delta for the 24h sparkline: recent-half total minus prior-half. */
function trendDelta(series: number[]): number {
	if (series.length < 2) {
		return 0;
	}
	const mid = Math.floor(series.length / 2);
	const prior = series.slice(0, mid).reduce((a, b) => a + b, 0);
	const recent = series.slice(mid).reduce((a, b) => a + b, 0);
	return recent - prior;
}

function StatGridSkeleton() {
	return (
		<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
			{["a", "b", "c", "d", "e"].map((slot) => (
				<Skeleton className="h-20 rounded-xl" key={slot} />
			))}
		</div>
	);
}

export function OrgAnalyticsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-5 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
					<header className="flex flex-col gap-1.5">
						<Skeleton className="h-8 w-40" />
						<Skeleton className="h-5 w-80" />
					</header>
					<StatGridSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
