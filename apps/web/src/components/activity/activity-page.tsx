import { ActivityIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityGroupRow } from "#/components/activity/activity-group";
import { ActivityRow } from "#/components/activity/activity-row";
import { LiveIndicator } from "#/components/activity/live-indicator";
import { EmptyState } from "#/components/common/empty-state";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import type { ActivityFeedItem } from "#/lib/activity.functions";
import { activityQueryOptions, useActivityStream } from "#/lib/activity.query";
import { cn } from "#/lib/utils";

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
	const { data, error, isSuccess } = useQuery(activityQueryOptions());
	useActivityStream();
	const [filter, setFilter] = useState<Filter>("all");

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
					<div className="flex flex-col gap-1.5">
						{items.map((item) =>
							item.type === "group" ? (
								<ActivityGroupRow group={item.group} key={itemKey(item)} />
							) : (
								<ActivityRow item={item.entry} key={itemKey(item)} />
							),
						)}
					</div>
				)}
			</div>
		</DashboardLayout>
	);
}

export function ActivityPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-3xl px-6 py-8">
				<div className="mb-6 h-8 w-40 animate-pulse rounded-md bg-surface-1" />
				<div className="flex flex-col gap-2">
					{Array.from({ length: 8 }, (_, i) => `activity-skel-${i}`).map(
						(key) => (
							<div
								className="h-11 animate-pulse rounded-md bg-surface-1"
								key={key}
							/>
						),
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}
