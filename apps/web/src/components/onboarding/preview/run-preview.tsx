import { useQuery } from "@tanstack/react-query";
import type { OnboardingRepo } from "@tripwire/contracts";
import { ModerationPreview } from "#/components/onboarding/preview/moderation-preview";
import { PreviewApp } from "#/components/onboarding/preview/preview-app";
import { RunBody } from "#/components/runs/run-page";
import { onboardingLatestRunQueryOptions } from "#/lib/onboarding-flow.query";
import { runQueryOptions } from "#/lib/runs.query";

/**
 * The run page for a reported change request, polling while the rules run.
 * With no run given it shows the repo's latest run, unless told not to, and
 * Human review when there is none.
 */
export function RunPreview({
	org,
	repo,
	runId,
	latestWhenNone = true,
}: {
	org: string;
	repo: OnboardingRepo | null;
	runId: string | null;
	/** False once the user has reported change requests: an unrelated run would
	 * contradict what the step says about theirs. */
	latestWhenNone?: boolean;
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
	if (!run.data) {
		return <ModerationPreview org={org} selected={repo ? [repo.id] : []} />;
	}
	return (
		<PreviewApp
			active="activity"
			collapsed
			forge={repo?.forge}
			repo={repo?.name ?? null}
			url={{ host: "app.tripwire.sh", path: `/runs/${run.data.id}` }}
		>
			<RunBody run={run.data} />
		</PreviewApp>
	);
}
