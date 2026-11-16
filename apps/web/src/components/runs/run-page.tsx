import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { BACKFILL_RUN_LABEL, FORGE_BY_ID } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { CopyButton } from "@tripwire/ui/copy-button";
import { Dialog } from "@tripwire/ui/dialog";
import { Copy, GithubMark, Icon, Retry, Workflow } from "@tripwire/ui/icon";
import { RelativeTime } from "@tripwire/ui/relative-time";
import { notify } from "@tripwire/ui/toast";
import { Caption, PageTitle } from "@tripwire/ui/typography";
import { useMemo, useState } from "react";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
} from "#/components/common/empty-state";
import { ForgeMark } from "#/components/common/forge-marks";
import {
	HistoryBackControl,
	useCanGoBack,
} from "#/components/common/history-back-control";
import { MetaRow } from "#/components/common/meta-row";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
import { RunChainView, RunStatusMark } from "#/components/runs/run-chain";
import { RunPageSkeleton } from "#/components/runs/run-page-skeleton";
import { ZoneOrgScope } from "#/components/timezones/zoned-time";
import { useActiveScope } from "#/hooks/use-active-scope";
import {
	getRerunPreview,
	rerunChangeRequest,
	rerunRulesLine,
} from "#/lib/activity.functions";
import { currentUserQueryOptions } from "#/lib/auth.query";
import { formatRelativeTime } from "#/lib/format-relative-time";
import { buildRunChain } from "#/lib/run-chain";
import { mergeLiveSteps } from "#/lib/run-live-steps";
import { runToMarkdown } from "#/lib/run-markdown";
import type { RunView } from "#/lib/runs.functions";
import { runQueryOptions } from "#/lib/runs.query";
import { siteConfig } from "#/lib/site-config";

const route = getRouteApi("/runs/$runId");

function sentence(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function RunPage() {
	const { runId } = route.useParams();
	const { data: run, isLoading } = useQuery(runQueryOptions(runId));
	const user = useQuery({
		...currentUserQueryOptions(),
		enabled: run?.access === "public",
	});

	if (isLoading || (run?.access === "public" && user.isPending)) {
		return <RunPageSkeleton />;
	}
	if (!run) {
		return (
			<main data-layout-role="run-not-found">
				<EmptyState
					art={<MascotArt mood="run-not-found" />}
					className="max-w-sm"
					data-layout-role="public-empty-state"
					reason="no-results"
				>
					<EmptyStateHeader>
						<PageTitle>Run not found</PageTitle>
						<EmptyStateDescription>
							The link may be wrong, or the run is in an org you are not a
							member of.
						</EmptyStateDescription>
					</EmptyStateHeader>
					<EmptyStateContent>
						<Button href="/" size="small" variant="secondary">
							Go to dashboard
						</Button>
					</EmptyStateContent>
				</EmptyState>
			</main>
		);
	}

	if (run.access === "public" && !user.data) {
		return (
			<div data-layout-role="public-run-shell">
				<main data-layout-role="public-run-main">
					<RunBody run={run} />
				</main>
				<footer data-layout-role="public-run-footer">
					<a
						href={siteConfig.githubRepositoryUrl}
						rel="noreferrer"
						target="_blank"
					>
						Powered by Tripwire
					</a>
					. {siteConfig.tagline}
				</footer>
			</div>
		);
	}

	return <DashboardRun run={run} />;
}

function DashboardRun({ run }: { run: RunView }) {
	const { from } = route.useSearch();
	const { org, repo } = useActiveScope();
	return (
		<DashboardLayout
			counts={{}}
			scope={org ? { org: org.slug, repo } : undefined}
			nestedNavItem={
				run.access !== "public"
					? {
							parent: from === "review" ? "moderation" : "activity",
							label: run.subjectNumber ? `Run #${run.subjectNumber}` : "Run",
						}
					: undefined
			}
		>
			<RunBody run={run} />
		</DashboardLayout>
	);
}

function RunBody({ run }: { run: RunView }) {
	const canGoBack = useCanGoBack();
	const { orgSlug, repoName } = run;
	const chain = useMemo(
		() =>
			buildRunChain(run, mergeLiveSteps(run.status, run.snapshot, run.steps)),
		[run],
	);

	return (
		<ZoneOrgScope
			org={run.access === "public" ? undefined : (run.orgSlug ?? undefined)}
		>
			<Page purpose="task">
				<PageHeader
					actions={
						<>
							{run.access !== "public" ? (
								<span data-layout-role="run-copy-action">
									<CopyButton
										icon={<Icon icon={Copy} size={12} />}
										label="run as Markdown"
										size="small"
										value={() =>
											runToMarkdown(run, formatRelativeTime(run.createdAt))
										}
										variant="ghost"
									/>
								</span>
							) : null}
							{run.access === "full" && orgSlug && repoName
								? run.workflowEditorLinks?.map(({ id, name }) => (
										<Button
											href={`/${encodeURIComponent(orgSlug)}/${encodeURIComponent(repoName)}/workflows/${encodeURIComponent(id)}`}
											key={id}
											leadingIcon={<Icon icon={Workflow} />}
											variant="secondary"
										>
											{name}
										</Button>
									))
								: null}
							<ViewOnForgeButton run={run} />
							{run.canRerun && run.orgSlug && run.repoName ? (
								<RerunRunButton
									number={run.subjectNumber}
									org={run.orgSlug}
									repo={run.repoName}
									subtitle={`#${run.subjectNumber} in ${run.repoFullName}`}
								/>
							) : null}
						</>
					}
					navigation={canGoBack ? <HistoryBackControl /> : undefined}
					metadata={
						<MetaRow wrap>
							<RunStatusMark outcome={chain.outcome} />
							{run.access === "public" ? <span>Public view</span> : null}
							{run.backfill ? <span>{BACKFILL_RUN_LABEL}</span> : null}
							<span>{run.repoFullName}</span>
							{run.access === "public" ? (
								<span>{formatRelativeTime(run.createdAt)}</span>
							) : (
								<Caption data-layout-role="run-timestamp">
									<RelativeTime date={run.createdAt} />
								</Caption>
							)}
						</MetaRow>
					}
					title={run.subjectNumber ? `Run on #${run.subjectNumber}` : "Run"}
				/>
				<PageBody>
					<RunChainView
						chain={chain}
						context={{
							level: run.redactionLevel,
							maintainer: run.access !== "public",
							repo: run.repoFullName,
							sha: run.headSha,
						}}
					/>
				</PageBody>
			</Page>
		</ZoneOrgScope>
	);
}

function ViewOnForgeButton({ run }: { run: RunView }) {
	if (!(run.forge && run.subjectUrl)) {
		return null;
	}
	const label = FORGE_BY_ID[run.forge]?.label ?? run.forge;
	const href = run.subjectUrl;
	return (
		<Button
			href={href}
			leadingIcon={
				run.forge === "github" ? (
					<Icon icon={GithubMark} />
				) : (
					<ForgeMark forge={run.forge} />
				)
			}
			openInNewTab
			variant="secondary"
		>
			View on {label}
		</Button>
	);
}

function RerunRunButton({
	org,
	repo,
	number,
	subtitle,
}: {
	org: string;
	repo: string;
	number: number | null;
	subtitle: string;
}) {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [unavailable, setUnavailable] = useState<string | null>(null);
	const preview = useQuery({
		queryKey: ["rerun-preview", org, repo],
		queryFn: () => getRerunPreview({ data: { org, repo } }),
		enabled: open,
		staleTime: 15_000,
	});
	const mutation = useMutation({
		mutationFn: rerunChangeRequest,
		onSuccess: (result) => {
			if (result.status === "queued") {
				setOpen(false);
				notify.show({ title: "Re-run queued. Opening the new run." });
				void navigate({
					params: { runId: result.runId },
					search: true,
					to: "/runs/$runId",
				});
			} else if (result.status === "cooldown") {
				setOpen(false);
				notify.show({
					title: `You can re-run this again in about ${Math.max(1, Math.ceil(result.retryInSeconds / 60))} min`,
				});
			} else if (result.status === "no-workflow") {
				setUnavailable(
					"Install a rule or turn on a workflow before running checks.",
				);
			} else if (result.status === "no-event") {
				setUnavailable(
					"Tripwire has nothing to check for this change request yet. Open or update it first.",
				);
			} else {
				setUnavailable("Tripwire is off for this repo. Turn it on first.");
			}
		},
		onError: () => {
			notify.show(
				{ title: "Tripwire could not start the re-run. Try again." },
				"error",
			);
		},
	});

	const rulesCopy =
		unavailable ??
		(preview.data
			? `${sentence(rerunRulesLine(preview.data.ruleNames))}. This may cost AI review usage. Tripwire will update its comment and check on the change request.`
			: "This runs your current rules again and may cost AI review usage. Tripwire will update its comment and check on the change request.");

	return (
		<Dialog
			action={
				unavailable || number == null
					? undefined
					: {
							label: "Re-run rules",
							onAction: () =>
								mutation.mutateAsync({ data: { org, repo, number } }),
							pendingLabel: "Queueing",
						}
			}
			description={subtitle}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setUnavailable(null);
				}
			}}
			open={open}
			title={number != null ? `Re-run rules on #${number}?` : "Re-run rules?"}
			trigger={
				<Button leadingIcon={<Icon icon={Retry} />} variant="secondary">
					Re-run rules
				</Button>
			}
		>
			<p className="content-body-small tone-content-secondary">{rulesCopy}</p>
		</Dialog>
	);
}
