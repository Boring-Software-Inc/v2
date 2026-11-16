import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Button } from "@tripwire/ui/button";
import { ItemGroup } from "@tripwire/ui/item";
import { SkeletonSwap } from "@tripwire/ui/skeleton";
import { useMemo } from "react";
import { ActivityFilters } from "#/components/activity/activity-filters";
import { ActivityHistory } from "#/components/activity/activity-history";
import { ActivityListSkeleton } from "#/components/activity/activity-page-skeleton";
import { ActivityRow } from "#/components/activity/activity-row";
import { ActivityStack } from "#/components/activity/activity-stack";
import { groupResult } from "#/components/activity/verdict-chip";
import { ArmCallout } from "#/components/arming/arm-callout";
import { BackfillProgress } from "#/components/arming/backfill-progress";
import {
	EmptyState,
	EmptyStateCode,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
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
				key: item.entry.eventId,
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
				<EmptyState art={<MascotArt mood="activity-error" />} reason="error">
					<EmptyStateHeader>
						<EmptyStateTitle>Tripwire could not load activity</EmptyStateTitle>
						<EmptyStateDescription>
							Tripwire keeps trying in the background. If the list does not come
							back, reload the page.
						</EmptyStateDescription>
					</EmptyStateHeader>
					<EmptyStateContent>
						<Button
							onAction={() => window.location.reload()}
							size="small"
							variant="secondary"
						>
							Reload page
						</Button>
					</EmptyStateContent>
				</EmptyState>
			) : (
				<SkeletonSwap
					fallback={<ActivityListSkeleton />}
					label="Loading activity"
					loading={!isSuccess}
				>
					{isSuccess && segments.length === 0 ? (
						filter === "all" ? (
							<EmptyState art={<MascotArt mood="activity-empty" />}>
								<EmptyStateHeader>
									<EmptyStateTitle>No activity yet</EmptyStateTitle>
									<EmptyStateDescription>
										{unarmed
											? "Tripwire is off for this repo. Turn it on to check new change requests and show them here."
											: "Tripwire is watching this repo. When a change request opens, its timeline and verdict show up here."}
									</EmptyStateDescription>
								</EmptyStateHeader>
								<EmptyStateContent>
									<Button
										href={`/${org}/${repoName}/rules`}
										size="small"
										variant="secondary"
									>
										Review rules
									</Button>
								</EmptyStateContent>
							</EmptyState>
						) : (
							<EmptyState
								art={<MascotArt mood="activity-no-matches" />}
								reason="no-results"
							>
								<EmptyStateHeader>
									<EmptyStateTitle>
										Nothing matches{" "}
										<EmptyStateCode>
											{ACTIVITY_VERDICT_LABELS[filter]}
										</EmptyStateCode>
									</EmptyStateTitle>
									<EmptyStateDescription>
										No activity on this repo matches this filter.
									</EmptyStateDescription>
								</EmptyStateHeader>
								<EmptyStateContent>
									<Button
										onAction={() => setFilter("all")}
										size="small"
										variant="secondary"
									>
										Show all activity
									</Button>
								</EmptyStateContent>
							</EmptyState>
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
												key={entry.eventId}
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
