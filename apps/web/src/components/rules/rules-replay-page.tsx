import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
	type ReplayRow,
	replayRules,
	ruleDisplayName,
	ruleSetLabel,
} from "@tripwire/contracts";
import { useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardMeta,
} from "#/components/glaze/ui/card";
import {
	Empty,
	EmptyHeader,
	EmptyRetry,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { Status } from "#/components/glaze/ui/status";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { replayRuleIds, turnableRuleIds } from "#/components/rules/rule-packs";
import { ReplayListSkeleton } from "#/components/rules/rules-replay-page-skeleton";
import { useSetupInstallRules } from "#/components/setup/use-repo-setup";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { orgRepoQueryOptions } from "#/lib/org.query";
import {
	ruleConfigsQueryOptions,
	ruleLibraryQueryOptions,
	rulesQueryKeys,
} from "#/lib/rules.query";

const routeApi = getRouteApi("/$org/$repo/moderation_/replay");

const SHOWN_ROWS = 5;

function ReplayRowView({ row }: { row: ReplayRow }) {
	const rule = row.ruleId ? ruleDisplayName(row.ruleId) : null;
	return (
		<li className="grid grid-cols-[--spacing(12)_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-3 not-first:border-line-faint not-first:border-t sm:grid-cols-[--spacing(12)_minmax(0,1fr)_--spacing(28)_--spacing(32)]">
			<span className="type-body-sm text-text-2 tabular-nums">
				#{row.number}
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="truncate type-body text-text-1">{row.title}</span>
				<span className="truncate type-body-sm text-text-2">{row.author}</span>
			</span>
			<span className="flex flex-col items-end gap-0.5 sm:items-start">
				{row.verdict === "blocked" ? (
					<Status status="fail">Blocked</Status>
				) : (
					<Status status="ok">Passed</Status>
				)}
				{rule ? (
					<span className="type-body-sm text-text-2 sm:hidden">{rule}</span>
				) : null}
			</span>
			<span className="truncate text-end type-body-sm text-text-2 max-sm:hidden">
				{rule}
			</span>
		</li>
	);
}

export function RulesReplayPage() {
	const { org, repo: repoName } = routeApi.useParams();
	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	const repoId = repo?.id ?? "";
	const rulesQuery = useQuery(ruleConfigsQueryOptions(org, repoId));
	const libraryQuery = useQuery(ruleLibraryQueryOptions(org, repoId));
	const canEdit = useOrgPermission(org, "rules:manage");
	const queryClient = useQueryClient();
	const [showAll, setShowAll] = useState(false);
	const { install, pending } = useSetupInstallRules({
		org,
		repo: repoName,
		repoId,
		armed: repo?.armed ?? false,
	});

	const rules = rulesQuery.data;
	const preview = libraryQuery.data?.preview ?? null;
	const replay =
		rules && preview ? replayRules(preview, replayRuleIds(rules)) : null;
	const turnable =
		replay && rules ? turnableRuleIds(rules, replay.ruleIds) : [];
	const label = replay ? ruleSetLabel(replay.ruleIds) : "";
	const loading =
		rulesQuery.isPending ||
		libraryQuery.isPending ||
		(preview === null &&
			(queryClient.getQueryState(rulesQueryKeys.library(org, repoId))
				?.dataUpdateCount ?? 0) < 12);
	const failed = rulesQuery.isError || libraryQuery.isError;
	const rows = replay
		? showAll
			? replay.rows
			: replay.rows.slice(0, SHOWN_ROWS)
		: [];

	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-wrap items-end justify-between gap-4">
						<div className="flex flex-col gap-1">
							<h1 className="type-title">Rule replay</h1>
							{replay ? (
								<p className="type-body text-text-2">
									Last {replay.windowDays} days with {label}
								</p>
							) : null}
						</div>
						{replay && turnable.length > 0 ? (
							<Button
								disabled={!canEdit || pending !== null}
								onClick={() => install("replay", label, turnable)}
								pending={pending === "replay"}
								pendingLabel="Installing"
							>
								Install these rules
							</Button>
						) : null}
					</header>

					{failed ? (
						<Empty reason="error">
							<EmptyHeader>
								<EmptyTitle>Could not load rule replay</EmptyTitle>
							</EmptyHeader>
							<EmptyRetry
								onRetry={async () => {
									await Promise.all([
										rulesQuery.refetch({ throwOnError: true }),
										libraryQuery.refetch({ throwOnError: true }),
									]);
								}}
							/>
						</Empty>
					) : replay ? (
						<Card>
							<CardContent flush>
								<ul aria-label="Change requests">
									{rows.map((row) => (
										<ReplayRowView key={row.number} row={row} />
									))}
								</ul>
							</CardContent>
							<CardFooter>
								<CardMeta>
									{replay.blocked} of {replay.rows.length} would have been
									blocked
								</CardMeta>
								{replay.rows.length > SHOWN_ROWS && !showAll ? (
									<Button
										onClick={() => setShowAll(true)}
										size="sm"
										variant="secondary"
									>
										Show all {replay.rows.length}
									</Button>
								) : null}
							</CardFooter>
						</Card>
					) : loading ? (
						<ReplayListSkeleton />
					) : (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>Nothing to replay yet</EmptyTitle>
							</EmptyHeader>
						</Empty>
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}
