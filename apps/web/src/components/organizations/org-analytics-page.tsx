import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Chart } from "#/components/glaze/ui/chart";
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { OrgAnalyticsBodySkeleton } from "#/components/organizations/org-analytics-page-skeleton";
import type { OrgAnalyticsSummary } from "#/lib/org.functions";
import { orgAnalyticsQueryOptions } from "#/lib/org.query";

const route = getRouteApi("/$org/analytics");

export function OrgAnalyticsPage() {
	const { org } = route.useParams();
	const { data: summary, error } = useQuery(orgAnalyticsQueryOptions(org));

	if (error) {
		throw error;
	}

	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Analytics</h1>
						<p className="type-body text-text-2">
							Totals across this org's repos. Per-repo analytics live on each
							repo's page.
						</p>
					</header>

					<SkeletonSwap
						fallback={<OrgAnalyticsBodySkeleton />}
						label="Loading analytics"
						loading={!summary}
					>
						{summary ? <OrgAnalyticsBody summary={summary} /> : null}
					</SkeletonSwap>
				</div>
			</div>
		</DashboardLayout>
	);
}

function hourLabel(index: number, length: number): string {
	const ago = length - 1 - index;
	return ago === 0 ? "Now" : `${ago}h ago`;
}

function Count({ value }: { value: number }) {
	return <span className="text-text-1 tabular-nums">{value}</span>;
}

function OrgAnalyticsBody({ summary }: { summary: OrgAnalyticsSummary }) {
	const length = Math.max(
		summary.eventsSeries.length,
		summary.blockedSeries.length,
	);
	const data = Array.from({ length }, (_, i) => ({
		hour: hourLabel(i, length),
		events: summary.eventsSeries[i] ?? null,
		blocked: summary.blockedSeries[i] ?? null,
	}));

	return (
		<div className="flex flex-col gap-6">
			<p className="type-body text-text-2">
				<Count value={summary.armedRepos} /> of <Count value={summary.repos} />{" "}
				repos armed. In the last 24 hours, <Count value={summary.events24h} />{" "}
				events and <Count value={summary.blocked24h} /> blocked.{" "}
				<Count value={summary.pendingModeration} /> awaiting review.
			</p>
			<Chart
				config={{
					hour: { label: "Hour" },
					events: { label: "Events" },
					blocked: { label: "Blocked", status: "fail" },
				}}
				data={data}
				empty="No events in the last 24 hours."
				label="Events and blocked, last 24 hours"
				type="line"
				unit="count"
				xKey="hour"
			/>
		</div>
	);
}
