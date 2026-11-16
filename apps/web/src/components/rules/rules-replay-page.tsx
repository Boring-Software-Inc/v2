import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
	type ReplayRow,
	replayRules,
	ruleDisplayName,
	ruleSetLabel,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Card, CardContent, CardFooter, CardMeta } from "@tripwire/ui/card";
import { Status } from "@tripwire/ui/status";
import { type Ref, useCallback, useRef, useState } from "react";
import {
	EmptyState,
	EmptyStateHeader,
	EmptyStateRetry,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import {
	HistoryBackControl,
	useCanGoBack,
} from "#/components/common/history-back-control";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { replayRuleIds, turnableRuleIds } from "#/components/rules/rule-packs";
import { ReplayListSkeleton } from "#/components/rules/rules-replay-page-skeleton";
import { useSetupInstallRules } from "#/components/setup/use-repo-setup";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { orgRepoQueryOptions } from "#/lib/org.query";
import {
	RULE_PREVIEW_FETCH_LIMIT,
	ruleConfigsQueryOptions,
	ruleLibraryQueryOptions,
	rulesQueryKeys,
} from "#/lib/rules.query";

const routeApi = getRouteApi("/$org/$repo/moderation_/replay");

const SHOWN_ROWS = 5;

function ReplayRowView({
	row,
	revealFocus,
}: {
	row: ReplayRow;
	revealFocus?: Ref<HTMLLIElement>;
}) {
	const rule = row.ruleId ? ruleDisplayName(row.ruleId) : null;
	return (
		<li
			data-layout-role="rules-replay-row"
			ref={revealFocus}
			tabIndex={revealFocus ? -1 : undefined}
		>
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
	const canGoBack = useCanGoBack();
	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	const repoId = repo?.id ?? "";
	const rulesQuery = useQuery(ruleConfigsQueryOptions(org, repoId));
	const libraryQuery = useQuery({
		...ruleLibraryQueryOptions(org, repoId),
		notifyOnChangeProps: ["data", "dataUpdatedAt", "status"],
	});
	const canEdit = useOrgPermission(org, "rules:manage");
	const queryClient = useQueryClient();
	const [showAll, setShowAll] = useState(false);
	const focusOnReveal = useRef(false);
	const focusFirstNewRow = useCallback((node: HTMLLIElement | null) => {
		if (node && focusOnReveal.current) {
			focusOnReveal.current = false;
			node.focus();
		}
	}, []);
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
				?.dataUpdateCount ?? 0) < RULE_PREVIEW_FETCH_LIMIT);
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
					<header data-layout-role="rules-replay-header">
						{canGoBack ? (
							<nav aria-label="Back" data-layout-role="page-navigation">
								<HistoryBackControl />
							</nav>
						) : null}
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
								onAction={() => install("replay", label, turnable)}
								pending={pending === "replay"}
								pendingLabel="Installing"
							>
								Install these rules
							</Button>
						) : null}
					</header>

					{failed ? (
						<EmptyState reason="error">
							<EmptyStateHeader>
								<EmptyStateTitle>Could not load rule replay</EmptyStateTitle>
							</EmptyStateHeader>
							<EmptyStateRetry
								onRetry={async () => {
									await Promise.all([
										rulesQuery.refetch({ throwOnError: true }),
										libraryQuery.refetch({ throwOnError: true }),
									]);
								}}
							/>
						</EmptyState>
					) : replay ? (
						<Card data-layout-role="rules-replay-results">
							<CardContent flush>
								<ul aria-label="Change requests">
									{rows.map((row, index) => (
										<ReplayRowView
											key={row.number}
											row={row}
											revealFocus={
												index === SHOWN_ROWS ? focusFirstNewRow : undefined
											}
										/>
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
										onAction={({ source }) => {
											focusOnReveal.current =
												source === "keyboard" || source === "virtual";
											setShowAll(true);
										}}
										size="small"
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
						<EmptyState>
							<EmptyStateHeader>
								<EmptyStateTitle>Nothing to replay yet</EmptyStateTitle>
							</EmptyStateHeader>
						</EmptyState>
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}
