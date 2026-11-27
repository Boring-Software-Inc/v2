import { useQuery } from "@tanstack/react-query";
import type { OnboardingRepo } from "@tripwire/contracts";
import { ModerationPreview } from "#/components/onboarding/preview/moderation-preview";
import { PreviewApp } from "#/components/onboarding/preview/preview-app";
import { RunBody } from "#/components/runs/run-page";
import { RunSkeletonBody } from "#/components/runs/run-page-skeleton";
import { onboardingLatestRunQueryOptions } from "#/lib/onboarding-flow.query";
import { runQueryOptions } from "#/lib/runs.query";

/**
 * The run page for a reported change request, polling while the rules run.
 * With no run given it shows the repo's latest run, unless told not to. While
 * a run is on its way it shows the run page loading, never another page, so
 * the page that rides in is the page that stays; Human review only when there
 * is no run at all.
 */
export function RunPreview({
	org,
	repo,
	runId,
	latestWhenNone = true,
	expecting = false,
}: {
	org: string;
	repo: OnboardingRepo | null;
	runId: string | null;
	/** False once the user has reported change requests: an unrelated run would
	 * contradict what the step says about theirs. */
	latestWhenNone?: boolean;
	/** A run is known to be coming, such as while the reported ones load. */
	expecting?: boolean;
}) {
	const latest = useQuery({
		...onboardingLatestRunQueryOptions(org, repo?.name ?? ""),
		enabled: runId === null && repo !== null && latestWhenNone,
	});
	const shown = runId ?? (latestWhenNone ? (latest.data ?? null) : null);
	const run = useQuery({
		...runQueryOptions(shown ?? ""),
		enabled: shown !== null,
	});
	const loading =
		shown !== null ||
		expecting ||
		(runId === null && latestWhenNone && latest.isPending && repo !== null);
	if (!run.data && !loading) {
		return <ModerationPreview org={org} selected={repo ? [repo.id] : []} />;
	}
	return (
		<PreviewApp
			active="activity"
			collapsed
			forge={repo?.forge}
			repo={repo?.name ?? null}
			url={{
				host: "app.tripwire.sh",
				path: run.data ? `/runs/${run.data.id}` : "/runs",
			}}
		>
			{run.data ? (
				<RunBody historyBack={false} run={run.data} />
			) : (
				<RunSkeletonBody />
			)}
		</PreviewApp>
	);
}
