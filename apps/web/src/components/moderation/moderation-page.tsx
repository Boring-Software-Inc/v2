import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ChartAtRest } from "#/components/analytics/chart-at-rest";
import { BackfillProgress } from "#/components/arming/backfill-progress";
import { Collection } from "#/components/collection/collection";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { ContributionAppealsQueue } from "#/components/moderation/contribution-appeals-queue";
import { MODERATION_COLLECTION } from "#/components/moderation/moderation-collection";
import { ModerationPageFrame } from "#/components/moderation/moderation-page-frame";
import {
	ModerationPageSkeleton,
	QueueSkeleton,
} from "#/components/moderation/moderation-page-skeleton";
import {
	ModerationQueue,
	ModerationQueueEmpty,
	moderationQueueOptions,
} from "#/components/moderation/moderation-queue";
import { RegionGate } from "#/components/organizations/region-gate";
import { RepoSetupChecklist } from "#/components/setup/repo-setup-checklist";
import { SetupDoneStrip } from "#/components/setup/setup-done-strip";
import { useRepoSetup } from "#/components/setup/use-repo-setup";
import { Button } from "#/design-system/ui/button";
import { Chart } from "#/design-system/ui/chart";
import {
	DataValue,
	PageTitle,
	SectionHeading,
	SupportingText,
} from "#/design-system/ui/typography";
import { useCollection } from "#/hooks/use-collection";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { moderationStatsQueryOptions } from "#/lib/moderation.query";
import type { ModStats } from "#/lib/moderation.types";
import { showsReviewQueue } from "#/lib/repo-setup";

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
	const queueQuery = useQuery(moderationQueueOptions(org, repoName));
	const collection = useCollection(
		MODERATION_COLLECTION,
		queueQuery.data?.items,
	);
	const canReadAnalytics = useOrgPermission(org, "analytics:read");
	const statsQuery = useQuery({
		...moderationStatsQueryOptions(org, repoName),
		enabled: canReadAnalytics,
	});

	const setup = useRepoSetup(org, repoName);
	if (setup.query.isPending) {
		return <ModerationPageSkeleton />;
	}
	const checklist =
		setup.state && setup.progress && !setup.progress.complete ? (
			<RepoSetupChecklist
				org={org}
				progress={setup.progress}
				repo={repoName}
				state={setup.state}
			/>
		) : null;
	if (
		checklist &&
		setup.state &&
		setup.progress &&
		!showsReviewQueue(
			setup.state.facts,
			setup.progress,
			queueQuery.data?.items.length ?? 0,
		)
	) {
		return (
			<DashboardLayout counts={{}}>
				<ModerationPageFrame>
					{checklist}
					<ContributionAppealsQueue org={org} repo={repoName} />
				</ModerationPageFrame>
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
	const queueContent = (
		<Collection
			collection={collection}
			empty={<ModerationQueueEmpty org={org} repo={repoName} />}
			error={queueQuery.isError}
			onRetry={async () => {
				await queueQuery.refetch({ throwOnError: true });
			}}
			skeleton={<QueueSkeleton />}
		>
			{(visibleRows) => (
				<>
					<ModerationQueue
						items={visibleRows}
						org={org}
						repo={repoName}
						title={
							<>
								Waiting{" "}
								<DataValue>
									{queue?.truncated ? `${queue.limit}+` : queue?.items.length}
								</DataValue>
							</>
						}
					/>
					{queue?.truncated ? (
						<SupportingText>Showing the newest {queue.limit}.</SupportingText>
					) : null}
				</>
			)}
		</Collection>
	);
	const analyticsContent = (
		<RegionGate
			org={org}
			placeholder={
				<Chart
					config={verdictConfig}
					data={[]}
					empty=""
					label="Verdicts by hour, last 24 hours"
					stacked
					type="bar"
					unit="count"
					xKey="hour"
				/>
			}
			region="analytics"
		>
			{rows.length > 0 && atRest ? (
				<ChartAtRest
					action={
						<Button
							nativeButton={false}
							render={
								<Link params={{ org, repo: repoName }} to="/$org/$repo/rules" />
							}
							size="sm"
							variant="primary"
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
		</RegionGate>
	);

	return (
		<DashboardLayout counts={counts}>
			<ModerationPageFrame>
				{checklist}
				{setup.progress?.complete ? (
					<SetupDoneStrip org={org} progress={setup.progress} repo={repoName} />
				) : null}
				<header data-layout-role="moderation-header">
					{checklist ? (
						<SectionHeading>Human review</SectionHeading>
					) : (
						<PageTitle>Human review</PageTitle>
					)}
					<SupportingText>
						Approve to continue the workflow, or block.
					</SupportingText>
				</header>
				<div data-layout-role="moderation-workspace">
					<div data-layout-role="moderation-primary">
						<BackfillProgress org={org} repo={repoName} />
						<div data-layout-role="moderation-queue">{queueContent}</div>
						<ContributionAppealsQueue org={org} repo={repoName} />
					</div>
					<div data-layout-role="moderation-secondary">{analyticsContent}</div>
				</div>
			</ModerationPageFrame>
		</DashboardLayout>
	);
}
