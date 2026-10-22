import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ChartAtRest } from "#/components/analytics/chart-at-rest";
import { ArmCallout } from "#/components/arming/arm-callout";
import { BackfillProgress } from "#/components/arming/backfill-progress";
import { Collection } from "#/components/collection/collection";
import { Button } from "#/components/glaze/ui/button";
import { Chart } from "#/components/glaze/ui/chart";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MODERATION_COLLECTION } from "#/components/moderation/moderation-collection";
import { QueueSkeleton } from "#/components/moderation/moderation-page-skeleton";
import {
	ModerationQueue,
	ModerationQueueEmpty,
	moderationQueueOptions,
} from "#/components/moderation/moderation-queue";
import { useCollection } from "#/hooks/use-collection";
import { moderationStatsQueryOptions } from "#/lib/moderation.query";
import type { ModStats } from "#/lib/moderation.types";
import { orgRepoQueryOptions } from "#/lib/org.query";

const routeApi = getRouteApi("/$org/$repo/moderation");

function hourLabel(hoursAgo: number): string {
	return hoursAgo === 0 ? "This hour" : `${hoursAgo}h ago`;
}

const verdictConfig = {
	hour: { label: "Hour" },
	passed: { label: "Passed", status: "ok" as const },
	blocked: { label: "Blocked", status: "fail" as const },
};

function verdictRows(stats: ModStats) {
	return stats.passed.series.map((passed, i) => ({
		hour: hourLabel(stats.passed.series.length - 1 - i),
		passed,
		blocked: stats.blocked.series[i] ?? 0,
	}));
}

export function ModerationPage() {
	const { org, repo: repoName } = routeApi.useParams();
	const repoQuery = useQuery(orgRepoQueryOptions(org, repoName));
	const queueQuery = useQuery(moderationQueueOptions(org, repoName));
	const collection = useCollection(
		MODERATION_COLLECTION,
		queueQuery.data?.items,
	);
	const statsQuery = useQuery(moderationStatsQueryOptions(org, repoName));

	const repo = repoQuery.data;
	if (repo && !repo.armed) {
		return (
			<DashboardLayout counts={{}}>
				<div className="px-4 py-6 md:px-8 md:py-10">
					<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
						<header className="flex flex-col gap-1">
							<h1 className="type-title">Human review</h1>
							<p className="type-body text-text-2">
								The queue fills in when you turn on Tripwire for this repo.
							</p>
						</header>
						<ArmCallout
							org={org}
							repo={repoName}
							repoFullName={repo.fullName}
							variant="hero"
						/>
					</div>
				</div>
			</DashboardLayout>
		);
	}

	if (statsQuery.error) {
		throw statsQuery.error;
	}

	const stats = statsQuery.data;
	const rows = stats ? verdictRows(stats) : [];
	const atRest = rows.every((row) => row.passed === 0 && row.blocked === 0);
	const queue = queueQuery.data;
	const counts = { queue: queue?.items.length };

	return (
		<DashboardLayout counts={counts}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Human review</h1>
						<p className="type-body text-text-2">
							Approve to continue the workflow, or block.
						</p>
					</header>

					<BackfillProgress org={org} repo={repoName} />

					<Collection
						collection={collection}
						empty={<ModerationQueueEmpty org={org} repo={repoName} />}
						error={queueQuery.isError}
						onRetry={async () => {
							await queueQuery.refetch({ throwOnError: true });
						}}
						skeleton={<QueueSkeleton />}
					>
						{(rows) => (
							<>
								<ModerationQueue
									items={rows}
									org={org}
									repo={repoName}
									title={
										<>
											Waiting{" "}
											<span className="text-text-2 tabular-nums">
												{queue?.truncated
													? `${queue.limit}+`
													: queue?.items.length}
											</span>
										</>
									}
								/>
								{queue?.truncated ? (
									<p className="type-body-sm text-text-2">
										Showing the newest {queue.limit}.
									</p>
								) : null}
							</>
						)}
					</Collection>

					{rows.length > 0 && atRest ? (
						<ChartAtRest
							action={
								<Button
									nativeButton={false}
									render={
										<Link
											params={{ org, repo: repoName }}
											to="/$org/$repo/rules"
										/>
									}
									size="sm"
									variant="ghost"
								>
									Review rules
								</Button>
							}
							config={verdictConfig}
							data={rows}
							label="Verdicts by hour, last 24 hours"
							message="No verdicts in the last 24 hours"
							stacked
							type="bar"
							unit="count"
							xKey="hour"
						/>
					) : (
						<Chart
							actions={
								<Button
									nativeButton={false}
									render={
										<Link
											params={{ org, repo: repoName }}
											search={{ metric: "blocked" }}
											to="/$org/$repo/analytics"
										/>
									}
									size="sm"
									variant="ghost"
								>
									Open analytics
								</Button>
							}
							config={verdictConfig}
							data={rows}
							empty="No verdicts in the last 24 hours"
							label="Verdicts by hour, last 24 hours"
							loading={!stats}
							stacked
							type="bar"
							unit="count"
							xKey="hour"
						/>
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}
