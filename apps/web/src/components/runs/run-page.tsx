import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { FORGE_BY_ID, workflowActionKindSchema } from "@tripwire/contracts";
import { useMemo, useState } from "react";
import { verdictStatus } from "#/components/activity/verdict-chip";
import { ForgeMark } from "#/components/common/forge-marks";
import { MetaRow } from "#/components/common/meta-row";
import { GithubMark, Icon, Retry } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/glaze/ui/card";
import { CopyButton } from "#/components/glaze/ui/copy-button";
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
} from "#/components/glaze/ui/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { Status, type StatusValue } from "#/components/glaze/ui/status";
import { toast } from "#/components/glaze/ui/toast";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MascotArt } from "#/components/mascot/mascot-art";
import { RunPageSkeleton } from "#/components/runs/run-page-skeleton";
import { StepCard } from "#/components/runs/step-card";
import { actionIcon, KIND_ICON } from "#/components/workflows/editor/step-meta";
import {
	getRerunPreview,
	rerunChangeRequest,
	rerunRulesLine,
} from "#/lib/activity.functions";
import { formatRelativeTime } from "#/lib/format-relative-time";
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

	if (isLoading) {
		return <RunPageSkeleton />;
	}
	if (!run) {
		return (
			<div className="flex min-h-dvh items-center justify-center bg-page px-4">
				<Empty
					art={<MascotArt mood="run-not-found" />}
					className="max-w-sm"
					reason="no-results"
				>
					<EmptyHeader>
						<EmptyTitle>Run not found</EmptyTitle>
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
			</div>
		);
	}

	if (run.access === "public") {
		return (
			<div className="flex min-h-dvh flex-col bg-page text-text-1">
				<div className="flex-1">
					<RunBody run={run} />
				</div>
				<footer className="border-line-faint border-t px-4 py-4 text-center type-caption text-text-2">
					<a
						className="text-text-1 hover:underline"
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

	return (
		<DashboardLayout counts={{}}>
			<RunBody run={run} />
		</DashboardLayout>
	);
}

function RunStatusLine({
	run,
	plannedRules,
}: {
	run: RunView;
	plannedRules: number;
}) {
	const evaluating = run.status === "queued" || run.status === "running";
	const finishedRules = run.steps.filter((s) => s.nodeKind === "rule").length;
	const verdict = verdictStatus(run.verdict);

	return (
		<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			{verdict ? (
				<Status status={verdict.status}>{verdict.label}</Status>
			) : null}
			{run.status === "paused" ? (
				<span className="type-label text-text-2">Waiting for a maintainer</span>
			) : null}
			{evaluating ? (
				<Status live status="running">
					{plannedRules > 0
						? `Checking ${finishedRules} of ${plannedRules} rules`
						: "Checking"}
				</Status>
			) : null}
			{run.status === "failed" ? (
				<Status status="fail">Did not finish</Status>
			) : null}
		</div>
	);
}

function RunBody({ run }: { run: RunView }) {
	const liveSteps = useMemo(
		() => mergeLiveSteps(run.status, run.snapshot, run.steps),
		[run.status, run.snapshot, run.steps],
	);
	const evaluating = run.status === "queued" || run.status === "running";

	return (
		<div className="px-4 py-6 md:px-8 md:py-10">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
				<header className="flex flex-col gap-2">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h1 className="type-title">
							{run.subjectNumber ? `Run on #${run.subjectNumber}` : "Run"}
						</h1>
						<div className="flex flex-wrap items-center gap-2">
							<CopyButton
								label="run as Markdown"
								size="icon"
								title="Copy run as Markdown"
								value={() =>
									runToMarkdown(run, formatRelativeTime(run.createdAt))
								}
								variant="ghost"
							/>
							<ViewOnForgeButton run={run} />
							{run.canRerun && run.orgSlug && run.repoName ? (
								<RerunRunButton
									number={run.subjectNumber}
									org={run.orgSlug}
									repo={run.repoName}
									subtitle={`#${run.subjectNumber} in ${run.repoFullName}`}
								/>
							) : null}
						</div>
					</div>
					<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<RunStatusLine
							plannedRules={
								liveSteps.filter((s) => s.nodeKind === "rule").length
							}
							run={run}
						/>
						<MetaRow className="type-body-sm text-text-2">
							<span>{run.repoFullName}</span>
							<span>{formatRelativeTime(run.createdAt)}</span>
							{run.rerun ? (
								<span>
									Manual re-run{run.rerunBy ? ` by ${run.rerunBy}` : ""}
								</span>
							) : null}
						</MetaRow>
					</div>
				</header>

				{run.stepsHidden ? null : (
					<Card>
						<CardHeader>
							<CardTitle>Steps</CardTitle>
						</CardHeader>
						<CardContent flush>
							{liveSteps.length === 0 ? (
								<p className="px-3 py-4 type-body-sm text-text-2">
									{evaluating
										? "Starting the check."
										: run.status === "failed"
											? "This run did not finish. Re-run rules to try again."
											: "Tripwire recorded no steps for this run."}
								</p>
							) : (
								liveSteps.map((step) => (
									<StepCard
										key={step.id}
										maintainer={run.access !== "public"}
										repo={run.repoFullName}
										sha={run.headSha}
										step={step}
									/>
								))
							)}
						</CardContent>
					</Card>
				)}

				{run.actions.length > 0 ? (
					<Card>
						<CardHeader>
							<CardTitle>Actions</CardTitle>
						</CardHeader>
						<CardContent flush>
							{run.actions.map((action) => (
								<div
									className="rule-row flex min-w-0 items-center min-h-(--row) gap-2.5 px-3 py-2"
									key={`${action.kind}-${action.recordedAt}`}
								>
									<Icon
										className="text-text-2"
										icon={actionGlyph(action.kind)}
									/>
									<span className="min-w-0 flex-1 truncate type-label">
										{actionName(action.kind)}
									</span>
									{action.delivery ? (
										<DeliveryStatus delivery={action.delivery} />
									) : (
										<ActionStatus status={action.status} />
									)}
								</div>
							))}
						</CardContent>
					</Card>
				) : null}
			</div>
		</div>
	);
}

type ActionStatusMap = Record<string, { status: StatusValue; label: string }>;
const ACTION_STATUS: ActionStatusMap = {
	executed: { status: "ok", label: "Done" },
	skipped: { status: "idle", label: "Skipped" },
	failed: { status: "fail", label: "Did not finish" },
	pending: { status: "queued", label: "Waiting" },
};

function ActionStatus({ status }: { status: string }) {
	const known = ACTION_STATUS[status];
	return (
		<Status size="sm" status={known?.status ?? "idle"}>
			{known?.label ?? sentence(status)}
		</Status>
	);
}

function actionGlyph(kind: string) {
	const parsed = workflowActionKindSchema.safeParse(kind);
	return parsed.success ? actionIcon(parsed.data) : KIND_ICON.action;
}

function actionName(kind: string): string {
	const words = kind.replace(/-/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function DeliveryStatus({
	delivery,
}: {
	delivery:
		| { state: "sent" }
		| { state: "queued" }
		| { state: "failed"; reason: string };
}) {
	if (delivery.state === "sent") {
		return (
			<Status size="sm" status="ok">
				Sent
			</Status>
		);
	}
	if (delivery.state === "queued") {
		return (
			<Status size="sm" status="queued">
				Queued
			</Status>
		);
	}
	return (
		<span className="flex min-w-0 items-center gap-2">
			<span className="min-w-0 truncate type-caption text-text-2">
				{delivery.reason}
			</span>
			<Status className="shrink-0" size="sm" status="fail">
				Not sent
			</Status>
		</span>
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
				void navigate({ params: { runId: result.runId }, to: "/runs/$runId" });
			} else if (result.status === "cooldown") {
				setOpen(false);
				toast(
					`You can re-run this again in about ${Math.max(1, Math.ceil(result.retryInSeconds / 60))} min`,
				);
			} else if (result.status === "no-workflow") {
				setUnavailable(
					"This repo has no rules or workflows turned on, so there is nothing to check. Turn one on first.",
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
