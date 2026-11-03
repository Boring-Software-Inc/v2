import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ActivityFilters } from "#/components/activity/activity-filters";
import { ActivityHistory } from "#/components/activity/activity-history";
import { ActivityListSkeleton } from "#/components/activity/activity-page-skeleton";
import { ActivityRow } from "#/components/activity/activity-row";
import { ActivityStack } from "#/components/activity/activity-stack";
import { groupResult } from "#/components/activity/verdict-chip";
import { ArmCallout } from "#/components/arming/arm-callout";
import { BackfillProgress } from "#/components/arming/backfill-progress";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
import { Button } from "#/design-system/ui/button";
import {
	Empty,
	EmptyCode,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/design-system/ui/empty-state";
import { ItemGroup } from "#/design-system/ui/item";
import { SkeletonSwap } from "#/design-system/ui/skeleton";
import type {
	ActivityFeedItem,
	ActivityGroup,
	ActivityItem,
} from "#/lib/activity.functions";
import { activityQueryOptions, useActivityStream } from "#/lib/activity.query";
import { orgRepoQueryOptions } from "#/lib/org.query";
import {
	ACTIVITY_VERDICT_LABELS,
	type ActivityVerdict,
} from "#/lib/repo-search";

const routeApi = getRouteApi("/$org/$repo/activity");

type Filter = ActivityVerdict;

function matches(item: ActivityFeedItem, filter: Filter): boolean {
	if (filter === "all") {
		return true;
	}
	if (item.type === "group") {
		return filter === "no-run"
			? item.group.currentVerdict === null
			: groupResult(item.group) === filter;
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
	const { org, repo } = routeApi.useParams();
	const { from, to, verdict } = routeApi.useSearch();
	const history = from && to && verdict !== "no-run";
	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<PageHeader
					description={
						history
							? undefined
							: "Filter by verdict. Open a change request to see its checks."
					}
					title={history ? "Activity history" : "Activity"}
				/>
				<PageBody>
					<ActivityFilters />
					{history ? (
						<ActivityHistory input={{ org, repo, from, to, verdict }} />
					) : (
						<CurrentActivityPage />
					)}
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}

function CurrentActivityPage() {
	const { org, repo: repoName } = routeApi.useParams();
	const { data, error, isSuccess } = useQuery(
		activityQueryOptions(org, repoName),
	);
	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	useActivityStream(org, repoName, repo);
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
		<>
			{unarmed && repo ? (
				<ArmCallout
					forge={repo.forge}
					org={org}
					repo={repoName}
					repoFullName={repo.fullName}
					variant="banner"
				/>
			) : (
				<BackfillProgress org={org} repo={repoName} />
			)}

			{error ? (
				<Empty art={<MascotArt mood="activity-error" />} reason="error">
					<EmptyHeader>
						<EmptyTitle>Tripwire could not load activity</EmptyTitle>
						<EmptyDescription>
							Tripwire keeps trying in the background. If the list does not come
							back, reload the page.
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
										<EmptyCode>{ACTIVITY_VERDICT_LABELS[filter]}</EmptyCode>
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
		</>
	);
}
