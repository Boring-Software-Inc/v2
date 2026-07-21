import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { RunPageSkeleton } from "#/components/runs/run-page-skeleton";
import { StepCard } from "#/components/runs/step-card";
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
					<CopyRunButton run={run} />
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
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<button
			className="ml-auto shrink-0 rounded-md bg-surface-1 px-2.5 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
			onClick={onCopy}
			type="button"
		>
			{copied ? "copied" : "copy markdown"}
		</button>
	);
}
