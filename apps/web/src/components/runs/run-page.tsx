import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { StepCard } from "#/components/runs/step-card";
import { formatRelativeTime } from "#/lib/format-relative-time";
import type { RunView } from "#/lib/runs.functions";
import { runQueryOptions } from "#/lib/runs.query";
import { MODERATOR, siteConfig } from "#/lib/site-config";
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
		<DashboardLayout counts={{}} moderator={MODERATOR}>
			<div className="overflow-stable h-full">
				<RunBody run={run} />
			</div>
		</DashboardLayout>
	);
}

function RunBody({ run }: { run: RunView }) {
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
				</div>
				<p className="mt-1 text-muted-foreground text-sm">
					{run.repoFullName}
					{run.subjectNumber ? ` #${run.subjectNumber}` : ""} ·{" "}
					{formatRelativeTime(run.createdAt)}
					{run.headSha ? (
						<span className="font-mono"> · {run.headSha.slice(0, 7)}</span>
					) : null}
				</p>
			</header>

			<section className="flex flex-col gap-2">
				<h2 className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
					steps
				</h2>
				{run.steps.map((step) => (
					<StepCard key={step.id} step={step} />
				))}
			</section>

			{run.actions.length > 0 ? (
				<section className="mt-8">
					<h2 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
						actions
					</h2>
					<div className="flex flex-col gap-1">
						{run.actions.map((action) => (
							<div
								className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-1"
								key={`${action.kind}-${action.recordedAt}`}
							>
								<span className="font-mono">{action.kind}</span>
								<span className="ml-auto text-muted-foreground text-xs">
									{action.status}
								</span>
							</div>
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}

export function RunPageSkeleton() {
	return (
		<div className="min-h-dvh bg-background">
			<div className="mx-auto w-full max-w-3xl px-6 py-8">
				<div className="mb-6 h-8 w-56 animate-pulse rounded-md bg-surface-1" />
				<div className="flex flex-col gap-2">
					{Array.from({ length: 6 }, (_, i) => `run-skel-${i}`).map((key) => (
						<div
							className="h-16 animate-pulse rounded-lg bg-surface-1"
							key={key}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
