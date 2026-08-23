import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { RunPageSkeleton } from "#/components/runs/run-page-skeleton";
import { StepCard } from "#/components/runs/step-card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { toast } from "#/components/ui/toast";
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
import { cn } from "#/lib/utils";

const route = getRouteApi("/runs/$runId");

const VERDICT_STYLE: Record<string, string> = {
	pass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	block: "bg-red-500/10 text-red-600 dark:text-red-400",
	needs_review: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

const VERDICT_LABEL: Record<string, string> = {
	pass: "passed",
	block: "blocked",
	needs_review: "sent to review",
};

export function RunPage() {
	const { runId } = route.useParams();
	const { data: run, isLoading } = useQuery(runQueryOptions(runId));

	if (isLoading) {
		return <RunPageSkeleton />;
	}
	if (!run) {
		return (
			<div className="flex min-h-dvh items-center justify-center bg-background px-6 text-center text-muted-foreground text-sm">
				run not found.
			</div>
		);
	}

	/**
	 * §10 — the public (no-session) view renders without dashboard chrome and
	 * carries the "powered by tripwire" footer; every public run is a demo to
	 * exactly the audience that installs Tripwire.
	 */
	if (run.access === "public") {
		return (
			<div className="flex min-h-dvh flex-col bg-background">
				<div className="flex-1">
					<RunBody run={run} />
				</div>
				<footer className="border-t px-6 py-4 text-center text-muted-foreground text-xs">
					<a
						className="font-medium transition-colors hover:text-foreground"
						href={siteConfig.githubRepositoryUrl}
						rel="noreferrer"
						target="_blank"
					>
						powered by tripwire
					</a>{" "}
					— {siteConfig.tagline}
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

/** The stack-style section header — surface-1 fill, matching the activity feed. */
function SectionHeader({ children }: { children: React.ReactNode }) {
	return (
		<div className="bg-surface-1 px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
			{children}
		</div>
	);
}

function RunBody({ run }: { run: RunView }) {
	const liveSteps = useMemo(
		() => mergeLiveSteps(run.status, run.snapshot, run.steps),
		[run.status, run.snapshot, run.steps],
	);
	const evaluating = run.status === "queued" || run.status === "running";
	const finishedRules = run.steps.filter((s) => s.nodeKind === "rule").length;
	const plannedRules = liveSteps.filter((s) => s.nodeKind === "rule").length;

	return (
		<div className="mx-auto w-full max-w-3xl px-6 py-8">
			<header className="mb-6">
				<div className="flex items-center gap-3">
					<h1 className="font-semibold text-2xl tracking-tight">Run</h1>
					{run.verdict ? (
						<span
							className={cn(
								"rounded-full px-2.5 py-0.5 font-medium text-xs",
								VERDICT_STYLE[run.verdict],
							)}
						>
							{VERDICT_LABEL[run.verdict]}
						</span>
					) : null}
					{run.status === "paused" ? (
						<span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 font-medium text-amber-600 text-xs dark:text-amber-400">
							awaiting moderation
						</span>
					) : null}
					{evaluating ? (
						<span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-muted-foreground text-xs">
							{plannedRules > 0
								? `evaluating · ${finishedRules} of ${plannedRules}`
								: "evaluating"}
						</span>
					) : null}
					{run.status === "failed" ? (
						<span className="rounded-full bg-red-500/10 px-2.5 py-0.5 font-medium text-red-600 text-xs dark:text-red-400">
							failed
						</span>
					) : null}
					<div className="ml-auto flex shrink-0 items-center gap-2">
						<CopyRunButton run={run} />
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
				<p className="mt-1 text-muted-foreground text-sm">
					{run.repoFullName}
					{run.subjectNumber ? ` #${run.subjectNumber}` : ""} ·{" "}
					{formatRelativeTime(run.createdAt)}
					{run.headSha ? (
						<span className="font-mono"> · {run.headSha.slice(0, 7)}</span>
					) : null}
					{/* §10: the fact of a manual re-run is public; the actor only
					    shows on the full view. */}
					{run.rerun
						? ` · manual re-run${run.rerunBy ? ` by ${run.rerunBy}` : ""}`
						: ""}
				</p>
			</header>

			<section className="overflow-hidden rounded-xl border bg-card">
				<SectionHeader>steps</SectionHeader>
				{liveSteps.length === 0 ? (
					<p className="px-4 py-6 text-muted-foreground text-sm">
						{evaluating
							? "starting evaluation…"
							: run.status === "failed"
								? "this re-run never evaluated — try again."
								: "no steps recorded."}
					</p>
				) : (
					liveSteps.map((step, i) => (
						<StepCard
							isFirst={i === 0}
							isLast={i === liveSteps.length - 1}
							key={step.id}
							maintainer={run.access !== "public"}
							repo={run.repoFullName}
							sha={run.headSha}
							step={step}
						/>
					))
				)}
			</section>

			{run.actions.length > 0 ? (
				<section className="mt-4 overflow-hidden rounded-xl border bg-card">
					<SectionHeader>actions</SectionHeader>
					{run.actions.map((action) => (
						<div
							className="flex items-center gap-3 px-4 py-3 text-sm"
							key={`${action.kind}-${action.recordedAt}`}
						>
							<span className="min-w-0 flex-1 truncate font-mono">
								{action.kind}
							</span>
							{action.delivery ? (
								<DeliveryBadge delivery={action.delivery} />
							) : (
								<span className="text-muted-foreground text-xs">
									{action.status}
								</span>
							)}
						</div>
					))}
				</section>
			) : null}
		</div>
	);
}

/**
 * Delivery state for a webhook/discord action — sent / queued / failed, never
 * the raw `recorded`. A failed delivery must read as failed, not delivered
 * (alerting integrity). The failure reason is named; the url is never shown.
 */
function DeliveryBadge({
	delivery,
}: {
	delivery:
		| { state: "sent" }
		| { state: "queued" }
		| { state: "failed"; reason: string };
}) {
	const label =
		delivery.state === "sent"
			? "sent"
			: delivery.state === "queued"
				? "queued"
				: `failed: ${delivery.reason}`;
	return (
		<span
			className={cn(
				"rounded-full px-2 py-0.5 font-medium text-[11px]",
				delivery.state === "sent" &&
					"bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
				delivery.state === "queued" && "bg-surface-1 text-muted-foreground",
				delivery.state === "failed" &&
					"bg-red-500/10 text-red-600 dark:text-red-400",
			)}
		>
			{label}
		</span>
	);
}

/**
 * Copy the whole run as markdown. Copied-state feedback: the label flips to
 * "copied" for ~2s. Serializes from the redacted RunView (never raw rows), so
 * the clipboard cannot carry a url the view stripped. Native button, so it is
 * keyboard accessible.
 */
function CopyRunButton({ run }: { run: RunView }) {
	const [copied, setCopied] = useState(false);
	const onCopy = () => {
		const md = runToMarkdown(run, formatRelativeTime(run.createdAt));
		navigator.clipboard?.writeText(md);
		toast({
			title: "copied to clipboard",
			body: "The run has been copied to your clipboard.",
			status: "success",
			action: { label: "close", onClick: () => {} },
		});
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<button
			className="shrink-0 rounded-md bg-surface-1 px-2.5 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
			onClick={onCopy}
			type="button"
		>
			{copied ? "copied" : "copy markdown"}
		</button>
	);
}

/**
 * Admin re-run of the change request, moved here from the activity feed (§6):
 * the trigger sits beside "copy markdown" and wears the same quiet toolbar
 * style, while the confirm keeps the destructive register — it spends real
 * evaluation and updates the PR's review comment and check. On queue it routes
 * to the freshly materialized run so the maintainer watches it evaluate live.
 */
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
				toast("re-run queued — opening the new run");
				void navigate({ params: { runId: result.runId }, to: "/runs/$runId" });
			} else if (result.status === "cooldown") {
				setOpen(false);
				toast(
					`re-run available again in ~${Math.max(1, Math.ceil(result.retryInSeconds / 60))} min`,
				);
			} else if (result.status === "no-workflow") {
				setUnavailable(
					"no enabled rules — nothing to evaluate. enable a rule or workflow first.",
				);
			} else if (result.status === "no-event") {
				setUnavailable(
					"no evaluatable event for this change request — open or update it first.",
				);
			} else {
				setUnavailable("this repo isn't armed — arm it first.");
			}
		},
		onError: () => {
			toast("re-run failed to queue — try again");
		},
	});

	const rulesCopy =
		unavailable ??
		(preview.data
			? `${rerunRulesLine(preview.data.ruleNames)}. this may cost ai review usage. the pr's review comment and check will be updated.`
			: "this runs your current rules again and may cost ai review usage. the pr's review comment and check will be updated.");

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
			<DialogTrigger
				className="shrink-0 rounded-md bg-surface-1 px-2.5 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
				type="button"
			>
				re-run rules
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>re-run rules?</DialogTitle>
					<DialogDescription className="truncate">{subtitle}</DialogDescription>
				</DialogHeader>
				<p className="px-5 pb-4 text-muted-foreground text-sm">{rulesCopy}</p>
				<DialogFooter>
					<DialogClose
						className="text-muted-foreground text-xs transition-colors hover:text-foreground"
						type="button"
					>
						cancel
					</DialogClose>
					{unavailable || number == null ? null : (
						<button
							className="rounded-md bg-red-500/10 px-3 py-1.5 font-medium text-red-600 text-xs transition-colors hover:bg-red-500/20 dark:text-red-400"
							disabled={mutation.isPending}
							onClick={() => mutation.mutate({ data: { org, repo, number } })}
							type="button"
						>
							{mutation.isPending ? "queueing…" : "confirm re-run"}
						</button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
