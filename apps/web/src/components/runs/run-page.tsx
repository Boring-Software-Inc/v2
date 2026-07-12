import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { StepCard } from "#/components/runs/step-card";
import { currentUserQueryOptions } from "#/lib/auth.query";
import { formatRelativeTime } from "#/lib/format-relative-time";
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

			<section className="overflow-hidden rounded-xl border bg-card">
				<SectionHeader>steps</SectionHeader>
				{run.steps.map((step, i) => (
					<StepCard
						isFirst={i === 0}
						isLast={i === run.steps.length - 1}
						key={step.id}
						step={step}
					/>
				))}
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
							<span className="text-muted-foreground text-xs">
								{action.status}
							</span>
						</div>
					))}
				</section>
			) : null}
		</div>
	);
}

function RunSkeletonBody() {
	// Mirrors RunBody: a header + a "steps" list, on the surface the shell owns.
	return (
		<div className="mx-auto w-full max-w-3xl px-6 py-8">
			<header className="mb-6">
				<div className="h-8 w-40 animate-pulse rounded-md bg-surface-1" />
				<div className="mt-2 h-4 w-64 animate-pulse rounded-md bg-surface-1" />
			</header>
			<div className="overflow-hidden rounded-xl border bg-card">
				<div className="h-9 animate-pulse bg-surface-1" />
				{Array.from({ length: 6 }, (_, i) => `run-skel-${i}`).map((key) => (
					<div className="px-4 py-3.5" key={key}>
						<div className="h-4 w-1/2 animate-pulse rounded bg-surface-1" />
					</div>
				))}
			</div>
		</div>
	);
}

export function RunPageSkeleton() {
	// The run page is dual-mode (§10): maintainers get the dashboard shell, public
	// viewers get a chromeless page. Branch the skeleton on session so neither
	// flashes the wrong frame — a signed-in maintainer's currentUser query is
	// already cached (chrome up front), a logged-out visitor resolves to null
	// (bare page, no chrome to flash away).
	const { data: user } = useQuery(currentUserQueryOptions());
	if (user) {
		return (
			<DashboardLayout counts={{}}>
				<RunSkeletonBody />
			</DashboardLayout>
		);
	}
	return (
		<div className="min-h-dvh bg-background">
			<RunSkeletonBody />
		</div>
	);
}
