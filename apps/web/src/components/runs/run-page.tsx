import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { BACKFILL_RUN_LABEL, FORGE_BY_ID } from "@tripwire/contracts";
import { useMemo, useState } from "react";
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
import { GithubMark, Icon, Retry, Workflow } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import { CopyButton } from "#/design-system/ui/copy-button";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/design-system/ui/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
} from "#/design-system/ui/empty-state";
import { toast } from "#/design-system/ui/toast";
import { PageTitle } from "#/design-system/ui/typography";
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
				<Empty
					art={<MascotArt mood="run-not-found" />}
					className="max-w-sm"
					reason="no-results"
				>
					<EmptyHeader>
						<PageTitle>Run not found</PageTitle>
						<EmptyDescription>
							The link may be wrong, or the run is in an org you are not a
							member of.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button
							nativeButton={false}
							render={<Link to="/" />}
							size="sm"
							variant="secondary"
						>
							Go to dashboard
						</Button>
					</EmptyContent>
				</Empty>
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
								<CopyButton
									label="run as Markdown"
									showLabel
									title="Copy run as Markdown"
									value={() =>
										runToMarkdown(run, formatRelativeTime(run.createdAt))
									}
									variant="ghost"
								/>
							) : null}
							{run.access === "full" && orgSlug && repoName
								? run.workflowEditorLinks?.map(({ id, name }) => (
										<Button
											key={id}
											nativeButton={false}
											render={
												<Link
													params={{
														org: orgSlug,
														repo: repoName,
														workflowId: id,
													}}
													to="/$org/$repo/workflows/$workflowId"
												/>
											}
											variant="secondary"
										>
											<Icon icon={Workflow} />
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
							<span>{formatRelativeTime(run.createdAt)}</span>
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
			nativeButton={false}
			render={(props) => (
				<a {...props} href={href} rel="noreferrer" target="_blank" />
			)}
			variant="secondary"
		>
			{run.forge === "github" ? (
				<Icon icon={GithubMark} />
			) : (
				<ForgeMark forge={run.forge} />
			)}
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
				toast("Re-run queued. Opening the new run.");
				void navigate({
					params: { runId: result.runId },
					search: true,
					to: "/runs/$runId",
				});
			} else if (result.status === "cooldown") {
				setOpen(false);
				toast(
					`You can re-run this again in about ${Math.max(1, Math.ceil(result.retryInSeconds / 60))} min`,
				);
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
			toast.fail("Tripwire could not start the re-run. Try again.");
		},
	});

	const rulesCopy =
		unavailable ??
		(preview.data
			? `${sentence(rerunRulesLine(preview.data.ruleNames))}. This may cost AI review usage. Tripwire will update its comment and check on the change request.`
			: "This runs your current rules again and may cost AI review usage. Tripwire will update its comment and check on the change request.");

	return (
		<Dialog
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setUnavailable(null);
				}
			}}
			open={open}
		>
			<DialogTrigger render={<Button variant="secondary" />}>
				<Icon icon={Retry} />
				Re-run rules
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{number != null ? `Re-run rules on #${number}?` : "Re-run rules?"}
					</DialogTitle>
					<DialogDescription className="truncate">{subtitle}</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<p className="type-body-sm text-text-2">{rulesCopy}</p>
				</DialogBody>
				<DialogFooter>
					<DialogClose>Cancel</DialogClose>
					{unavailable || number == null ? null : (
						<DialogAction
							close={false}
							onClick={() => mutation.mutate({ data: { org, repo, number } })}
							pending={mutation.isPending}
							pendingLabel="Queueing"
						>
							Re-run rules
						</DialogAction>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
