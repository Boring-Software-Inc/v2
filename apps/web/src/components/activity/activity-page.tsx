import { ActivityIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ActivityRow } from "#/components/activity/activity-row";
import { ActivityStack } from "#/components/activity/activity-stack";
import { LiveIndicator } from "#/components/activity/live-indicator";
import { ArmCallout } from "#/components/arming/arm-callout";
import { BackfillProgress } from "#/components/arming/backfill-progress";
import { EmptyState } from "#/components/common/empty-state";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import type { ActivityFeedItem } from "#/lib/activity.functions";
import { activityQueryOptions, useActivityStream } from "#/lib/activity.query";
import { orgContextQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";
import { cn } from "#/lib/utils";

const routeApi = getRouteApi("/$org/$repo/activity");

type Filter = "all" | "block" | "needs_review" | "pass" | "no-run";

const FILTERS: { key: Filter; label: string }[] = [
	{ key: "all", label: "all" },
	{ key: "block", label: "blocked" },
	{ key: "needs_review", label: "sent to review" },
	{ key: "pass", label: "passed" },
	{ key: "no-run", label: "no run" },
];

/** Filter GROUPS by their current verdict; standalone events only match all/no-run. */
function matches(item: ActivityFeedItem, filter: Filter): boolean {
	if (filter === "all") {
		return true;
	}
	if (item.type === "group") {
		return filter === "no-run"
			? item.group.currentVerdict === null
			: item.group.currentVerdict === filter;
	}
	return filter === "no-run" && item.entry.run === null && !item.entry.pending;
}

function itemKey(item: ActivityFeedItem): string {
	return item.type === "group"
		? `${item.group.repoFullName}#${item.group.subjectNumber}`
		: item.entry.event.id;
}

export function ActivityPage() {
	const { org, repo: repoName } = routeApi.useParams();
	const { data, error, isSuccess } = useQuery(
		activityQueryOptions(org, repoName),
	);
	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const isAdmin = orgContext?.role === "admin";
	useActivityStream(org, repoName, repo?.fullName);
	const [filter, setFilter] = useState<Filter>("all");
	const unarmed = Boolean(repo && !repo.armed);

	// Filter over the cached feed — instant, and live rows still land in cache.
	const items = useMemo(
		() => (data?.items ?? []).filter((item) => matches(item, filter)),
		[data?.items, filter],
	);

	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-3xl px-6 py-8">
				<header className="mb-4 flex items-center justify-between">
					<div>
						<h1 className="font-semibold text-2xl tracking-tight">Activity</h1>
						<p className="text-muted-foreground text-sm">
							every change request and the verdicts it triggered, live.
						</p>
					</div>
					<LiveIndicator live={isSuccess} />
				</header>

				{unarmed && repo ? (
					<ArmCallout
						className="mb-4"
						org={org}
						repo={repoName}
						repoFullName={repo.fullName}
						variant="banner"
					/>
				) : (
					<BackfillProgress className="mb-4" org={org} repo={repoName} />
				)}

				<div className="mb-4 flex flex-wrap gap-1.5">
					{FILTERS.map((f) => (
						<button
							className={cn(
								"rounded-full px-2.5 py-1 font-medium text-xs transition-colors",
								filter === f.key
									? "bg-foreground text-background"
									: "bg-surface-1 text-muted-foreground hover:text-foreground",
							)}
							key={f.key}
							onClick={() => setFilter(f.key)}
							type="button"
						>
							{f.label}
						</button>
					))}
				</div>

				{error ? (
					<EmptyState
						className="text-red-500"
						description="something went wrong reading the feed. it'll refresh on its own, or reload the page."
						title="couldn't load activity"
					/>
				) : isSuccess && items.length === 0 ? (
					filter === "all" ? (
						<EmptyState
							description="this repo is linked and listening. the moment a change request opens, its timeline and verdict show up here — live."
							icon={ActivityIcon}
							title="no activity yet"
						/>
					) : (
						<EmptyState
							description="no change request matches this filter yet. clear it to see everything."
							icon={ActivityIcon}
							title="nothing matches this filter"
						/>
					)
				) : (
					<div className="flex flex-col gap-3">
						{items.map((item) =>
							item.type === "group" ? (
								<ActivityStack
									group={item.group}
									key={itemKey(item)}
									rerun={isAdmin ? { org, repo: repoName } : null}
								/>
							) : (
								<ActivityRow
									item={item.entry}
									key={itemKey(item)}
									unarmed={unarmed}
								/>
							),
						)}
					</div>
				)}
			</div>
		</DashboardLayout>
	);
}
