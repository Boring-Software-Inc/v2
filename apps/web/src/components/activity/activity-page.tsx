import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ActivityListSkeleton } from "#/components/activity/activity-page-skeleton";
import { ActivityRow } from "#/components/activity/activity-row";
import { ActivityStack } from "#/components/activity/activity-stack";
import { LiveIndicator } from "#/components/activity/live-indicator";
import { ArmCallout } from "#/components/arming/arm-callout";
import { BackfillProgress } from "#/components/arming/backfill-progress";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyCode,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { ItemGroup } from "#/components/glaze/ui/item";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MascotArt } from "#/components/mascot/mascot-art";
import type {
	ActivityFeedItem,
	ActivityGroup,
	ActivityItem,
} from "#/lib/activity.functions";
import { activityQueryOptions, useActivityStream } from "#/lib/activity.query";
import { orgRepoQueryOptions } from "#/lib/org.query";

const routeApi = getRouteApi("/$org/$repo/activity");

type Filter = "all" | "block" | "needs_review" | "pass" | "no-run";

const FILTERS: { key: Filter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "block", label: "Blocked" },
	{ key: "needs_review", label: "Sent to review" },
	{ key: "pass", label: "Passed" },
	{ key: "no-run", label: "No run" },
];

function isFilter(value: unknown): value is Filter {
	return FILTERS.some((f) => f.key === value);
}

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

type Segment =
	| { type: "group"; key: string; group: ActivityGroup }
	| { type: "rows"; key: string; entries: ActivityItem[] };

function segmentsOf(items: ActivityFeedItem[]): Segment[] {
	const out: Segment[] = [];
	for (const item of items) {
		if (item.type === "group") {
			out.push({
				type: "group",
				key: `${item.group.repoFullName}#${item.group.subjectNumber}`,
				group: item.group,
			});
			continue;
		}
		const last = out.at(-1);
		if (last?.type === "rows") {
			last.entries.push(item.entry);
		} else {
			out.push({
				type: "rows",
				key: item.entry.event.id,
				entries: [item.entry],
			});
		}
	}
	return out;
}

export function ActivityPage() {
	const { org, repo: repoName } = routeApi.useParams();
	const { data, error, isSuccess } = useQuery(
		activityQueryOptions(org, repoName),
	);
	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	useActivityStream(org, repoName, repo?.fullName);
	const [filter, setFilter] = useState<Filter>("all");
	const unarmed = Boolean(repo && !repo.armed);

	const segments = useMemo(
		() =>
			segmentsOf((data?.items ?? []).filter((item) => matches(item, filter))),
		[data?.items, filter],
	);

	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex items-start justify-between gap-4">
						<div className="flex flex-col gap-1">
							<h1 className="type-title">Activity</h1>
							<p className="type-body text-text-2">
								Every change request and the verdicts it triggered, live.
							</p>
						</div>
						<LiveIndicator live={isSuccess} />
					</header>

					{unarmed && repo ? (
						<ArmCallout
							org={org}
							repo={repoName}
							repoFullName={repo.fullName}
							variant="banner"
						/>
					) : (
						<BackfillProgress org={org} repo={repoName} />
					)}

					<div className="-mx-4 overflow-x-auto px-4">
						<SegmentedControl
							aria-label="Filter by verdict"
							onValueChange={(value) => {
								if (isFilter(value)) {
									setFilter(value);
								}
							}}
							size="sm"
							value={filter}
						>
							{FILTERS.map((f) => (
								<SegmentedControlItem key={f.key} value={f.key}>
									{f.label}
								</SegmentedControlItem>
							))}
						</SegmentedControl>
					</div>

					{error ? (
						<Empty art={<MascotArt mood="activity-error" />} reason="error">
							<EmptyHeader>
								<EmptyTitle>Couldn't load activity</EmptyTitle>
								<EmptyDescription>
									The feed retries on its own. Reload the page if it doesn't
									come back.
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button
									onClick={() => window.location.reload()}
									size="sm"
									variant="secondary"
								>
									Reload page
								</Button>
							</EmptyContent>
						</Empty>
					) : (
						<SkeletonSwap
							fallback={<ActivityListSkeleton />}
							label="Loading activity"
							loading={!isSuccess}
						>
							{isSuccess && segments.length === 0 ? (
								filter === "all" ? (
									<Empty art={<MascotArt mood="activity-empty" />}>
										<EmptyHeader>
											<EmptyTitle>No activity yet</EmptyTitle>
											<EmptyDescription>
												This repo is linked and listening. The moment a change
												request opens, its timeline and verdict show up here.
											</EmptyDescription>
										</EmptyHeader>
										<EmptyContent>
											<Button
												nativeButton={false}
												render={
													<Link
														params={{ org, repo: repoName }}
														to="/$org/$repo/rules"
													/>
												}
												size="sm"
												variant="secondary"
											>
												Review rules
											</Button>
										</EmptyContent>
									</Empty>
								) : (
									<Empty
										art={<MascotArt mood="activity-no-matches" />}
										reason="no-results"
									>
										<EmptyHeader>
											<EmptyTitle>
												Nothing matches{" "}
												<EmptyCode>
													{FILTERS.find((f) => f.key === filter)?.label}
												</EmptyCode>
											</EmptyTitle>
											<EmptyDescription>
												No change request matches this filter yet.
											</EmptyDescription>
										</EmptyHeader>
										<EmptyContent>
											<Button
												onClick={() => setFilter("all")}
												size="sm"
												variant="secondary"
											>
												Clear filter
											</Button>
										</EmptyContent>
									</Empty>
								)
							) : (
								<div className="flex flex-col gap-3">
									{segments.map((segment) =>
										segment.type === "group" ? (
											<ActivityStack group={segment.group} key={segment.key} />
										) : (
											<ItemGroup aria-label="Events" key={segment.key}>
												{segment.entries.map((entry) => (
													<ActivityRow
														item={entry}
														key={entry.event.id}
														unarmed={unarmed}
													/>
												))}
											</ItemGroup>
										),
									)}
								</div>
							)}
						</SkeletonSwap>
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}
