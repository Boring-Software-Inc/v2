import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useRef } from "react";
import { ArmCallout } from "#/components/arming/arm-callout";
import { BackfillProgress } from "#/components/arming/backfill-progress";
import { DitherStatCard } from "#/components/charts/dither-stat-card";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import {
	ModerationQueue,
	moderationQueueOptions,
} from "#/components/moderation/moderation-queue";
import { Skeleton } from "#/components/ui/skeleton";
import { moderationStatsQueryOptions } from "#/lib/moderation.query";
import { orgRepoQueryOptions } from "#/lib/org.query";

const routeApi = getRouteApi("/$org/$repo/moderation");

/**
 * The SCOPED moderation queue for the URL's repo (§8). The org home is the
 * only cross-repo page; this and every other surface stay scoped. An unarmed
 * repo dominates with the arm CTA — the queue is silent until the gate is on.
 */
export function ModerationPage() {
	const { org, repo: repoName } = routeApi.useParams();
	const repoQuery = useQuery(orgRepoQueryOptions(org, repoName));
	const queueQuery = useQuery(moderationQueueOptions(org, repoName));
	const statsQuery = useQuery(moderationStatsQueryOptions(org, repoName));

	const fetchedStats = useRef(false);
	if (statsQuery.isLoading) {
		fetchedStats.current = true;
	}
	const animateStats = fetchedStats.current;

	const repo = repoQuery.data;
	if (repo && !repo.armed) {
		return (
			<DashboardLayout counts={{}}>
				<div className="px-5 py-6 md:px-8 md:py-10">
					<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
						<header className="flex flex-col gap-1.5">
							<h1 className="font-semibold text-2xl tracking-tight">
								Moderation
							</h1>
							<p className="text-muted-foreground text-sm">
								the queue fills in the moment you arm this repo.
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

	if (queueQuery.error) {
		throw queueQuery.error;
	}
	if (statsQuery.error) {
		throw statsQuery.error;
	}

	const items = queueQuery.data ?? [];
	const counts = { queue: queueQuery.data?.length };

	return (
		<DashboardLayout counts={counts}>
			<div className="px-5 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
					<header className="flex flex-col gap-1.5">
						<h1 className="font-semibold text-2xl tracking-tight">
							Moderation
						</h1>
						<p className="text-muted-foreground text-sm">
							triage flagged change requests and comments for this repo.
						</p>
					</header>

					<BackfillProgress org={org} repo={repoName} />

					{statsQuery.data ? (
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
							<DitherStatCard
								animate={animateStats}
								color="orange"
								delay={0}
								delta={statsQuery.data.sentToReview.delta}
								focused
								goodDirection="down"
								label="Sent to review"
								onClick={() =>
									document
										.getElementById("moderation-queue")
										?.scrollIntoView({ behavior: "smooth", block: "start" })
								}
								series={statsQuery.data.sentToReview.series}
								value={String(statsQuery.data.sentToReview.value)}
							/>
							<DitherStatCard
								animate={animateStats}
								chartLayoutId="chart-moderation-blocked"
								color="red"
								delay={90}
								delta={statsQuery.data.blocked.delta}
								goodDirection="neutral"
								label="Blocked · 24h"
								linkTo={{ org, repo: repoName, metric: "blocked" }}
								series={statsQuery.data.blocked.series}
								value={String(statsQuery.data.blocked.value)}
							/>
							<DitherStatCard
								animate={animateStats}
								chartLayoutId="chart-moderation-passed"
								color="green"
								delay={180}
								delta={statsQuery.data.passed.delta}
								goodDirection="up"
								label="Passed · 24h"
								linkTo={{ org, repo: repoName, metric: "passed" }}
								series={statsQuery.data.passed.series}
								value={String(statsQuery.data.passed.value)}
							/>
						</div>
					) : (
						<PanelSkeleton />
					)}

					{queueQuery.data ? (
						<div id="moderation-queue">
							<ModerationQueue
								org={org}
								repo={repoName}
								title={
									<h2 className="font-medium text-sm">
										pending{" "}
										<span className="text-muted-foreground tabular-nums">
											{items.length}
										</span>
									</h2>
								}
							/>
						</div>
					) : (
						<QueueSkeleton />
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}

export function ModerationPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-5 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
					<Skeleton className="h-8 w-40" />
					<PanelSkeleton />
					<QueueSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}

const QUEUE_SLOTS = ["a", "b", "c", "d", "e", "f"];
const CARD_SLOTS = ["review", "blocked", "passed"];

function PanelSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
			{CARD_SLOTS.map((slot) => (
				<Skeleton className="h-28 rounded-xl" key={slot} />
			))}
		</div>
	);
}

function QueueSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<Skeleton className="mx-3 h-5 w-40" />
			<div className="flex flex-col gap-1">
				{QUEUE_SLOTS.map((slot) => (
					<Skeleton className="h-14 rounded-lg" key={slot} />
				))}
			</div>
		</div>
	);
}
