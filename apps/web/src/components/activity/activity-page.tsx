import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ActivityListSkeleton } from "#/components/activity/activity-page-skeleton";
import { ActivityRow } from "#/components/activity/activity-row";
import { ActivityStack } from "#/components/activity/activity-stack";
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
import { pickValue } from "#/lib/pick-value";
import { ACTIVITY_VERDICTS, type ActivityVerdict } from "#/lib/repo-search";

const routeApi = getRouteApi("/$org/$repo/activity");

type Filter = ActivityVerdict;

const FILTERS: { key: Filter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "block", label: "Blocked" },
	{ key: "needs_review", label: "Human review" },
	{ key: "pass", label: "Passed" },
	{ key: "no-run", label: "Not checked" },
];

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
	const { verdict: filter } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();
	const setFilter = (verdict: Filter) =>
		void navigate({
			search: (prev) => ({ ...prev, verdict }),
			replace: true,
			resetScroll: false,
		});
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
					<header className="flex flex-col gap-1">
						<h1 className="type-title">Activity</h1>
						<p className="type-body text-text-2">
							Change requests, comments and pushes on this repo, with the
							verdict Tripwire gave each one. The list updates live.
						</p>
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
							className="w-max"
							onValueChange={(value) => {
								const next = pickValue(ACTIVITY_VERDICTS, value);
								if (next) {
									setFilter(next);
								}
							}}
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
								<EmptyTitle>Tripwire could not load activity</EmptyTitle>
								<EmptyDescription>
									Tripwire keeps trying in the background. If the list does not
									come back, reload the page.
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
												{unarmed
													? "Tripwire is off for this repo. Turn it on to check new change requests and show them here."
													: "Tripwire is watching this repo. When a change request opens, its timeline and verdict show up here."}
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
												No activity on this repo matches this filter.
											</EmptyDescription>
										</EmptyHeader>
										<EmptyContent>
											<Button
												onClick={() => setFilter("all")}
												size="sm"
												variant="secondary"
											>
												Show all activity
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
