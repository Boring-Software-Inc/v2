import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { FORGE_BY_ID } from "@tripwire/contracts";
import { useMemo, useState } from "react";
import { verdictStatus } from "#/components/activity/verdict-chip";
import { ForgeMark } from "#/components/common/forge-marks";
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
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { Status } from "#/components/glaze/ui/status";
import { toast } from "#/components/glaze/ui/toast";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { RunPageSkeleton } from "#/components/runs/run-page-skeleton";
import { StepCard } from "#/components/runs/step-card";
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
				<Empty reason="no-results">
					<EmptyHeader>
						<EmptyTitle>Run not found</EmptyTitle>
						<EmptyDescription>
							It may have been removed, or the link is wrong.
						</EmptyDescription>
					</EmptyHeader>
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
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
			{verdict ? (
				<Status status={verdict.status}>{verdict.label}</Status>
			) : null}
			{run.status === "paused" ? (
				<Status status="waiting">Awaiting moderation</Status>
			) : null}
			{evaluating ? (
				<Status live status="running">
					{plannedRules > 0
						? `Evaluating ${finishedRules} of ${plannedRules}`
						: "Evaluating"}
				</Status>
			) : null}
			{run.status === "failed" ? <Status status="fail">Failed</Status> : null}
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
						<h1 className="type-title">Run</h1>
						<div className="flex flex-wrap items-center gap-1.5">
							<ViewOnForgeButton run={run} />
							<CopyButton
								label="run as markdown"
								showLabel
								size="sm"
								value={() =>
									runToMarkdown(run, formatRelativeTime(run.createdAt))
								}
								variant="secondary"
							/>
							{run.canRerun && run.orgSlug && run.repoName ? (
								<RerunRunButton
									number={run.subjectNumber}
									org={run.orgSlug}
									repo={run.repoName}
									subtitle={`#${run.subjectNumber} · ${run.repoFullName}`}
								/>
							) : null}
						</div>
					</div>
					<RunStatusLine
						plannedRules={liveSteps.filter((s) => s.nodeKind === "rule").length}
						run={run}
					/>
					<p className="type-body-sm text-text-2">
						{run.repoFullName}
						{run.subjectNumber ? ` #${run.subjectNumber}` : ""} ·{" "}
						{formatRelativeTime(run.createdAt)}
						{run.headSha ? (
							<>
								{" · "}
								<span className="mono">{run.headSha.slice(0, 7)}</span>
							</>
						) : null}
						{run.rerun
							? ` · manual re-run${run.rerunBy ? ` by ${run.rerunBy}` : ""}`
							: ""}
					</p>
				</header>

				<Card>
					<CardHeader>
						<CardTitle>Steps</CardTitle>
					</CardHeader>
					<CardContent flush>
						{liveSteps.length === 0 ? (
							<p className="px-3 py-4 type-body-sm text-text-2">
								{evaluating
									? "Starting evaluation."
									: run.status === "failed"
										? "This re-run never evaluated. Try again."
										: "No steps recorded."}
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

				{run.actions.length > 0 ? (
					<Card>
						<CardHeader>
							<CardTitle>Actions</CardTitle>
						</CardHeader>
						<CardContent flush>
							{run.actions.map((action) => (
								<div
									className="rule-row flex min-w-0 items-center gap-3 px-3 py-2.5"
									key={`${action.kind}-${action.recordedAt}`}
								>
									<span className="min-w-0 flex-1 truncate type-code-sm">
										{action.kind}
									</span>
									{action.delivery ? (
										<DeliveryStatus delivery={action.delivery} />
									) : (
										<span className="type-caption text-text-2">
											{action.status}
										</span>
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
		return <Status size="sm" status="queued" />;
	}
	return (
		<span className="flex min-w-0 items-center gap-2">
			<span className="min-w-0 truncate type-caption text-text-2">
				{delivery.reason}
			</span>
			<Status className="shrink-0" size="sm" status="fail" />
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
			size="sm"
			variant="secondary"
		>
			<ForgeMark className="size-(--icon-sm) shrink-0" forge={run.forge} />
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
					`Re-run available again in about ${Math.max(1, Math.ceil(result.retryInSeconds / 60))} min`,
				);
			} else if (result.status === "no-workflow") {
				setUnavailable(
					"No enabled rules, so there is nothing to evaluate. Enable a rule or workflow first.",
				);
			} else if (result.status === "no-event") {
				setUnavailable(
					"No evaluatable event for this change request. Open or update it first.",
				);
			} else {
				setUnavailable("This repo isn't armed. Arm it first.");
			}
		},
		onError: () => {
			toast.fail("Re-run failed to queue. Try again.");
		},
	});

	const rulesCopy =
		unavailable ??
		(preview.data
			? `${sentence(rerunRulesLine(preview.data.ruleNames))}. This may cost AI review usage. The PR's review comment and check will be updated.`
			: "This runs your current rules again and may cost AI review usage. The PR's review comment and check will be updated.");

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
			<DialogTrigger render={<Button size="sm" variant="secondary" />}>
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
							Confirm re-run
						</DialogAction>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
