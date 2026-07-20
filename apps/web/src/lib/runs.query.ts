import { queryOptions } from "@tanstack/react-query";
import { getLatestRunId, getRun } from "#/lib/runs.functions";

export const runsQueryKeys = {
	all: ["runs"] as const,
	details: () => [...runsQueryKeys.all, "detail"] as const,
	detail: (runId: string) => [...runsQueryKeys.details(), runId] as const,
	latest: (org: string, repo: string) =>
		[...runsQueryKeys.all, "latest", org, repo] as const,
};

/** §4 — the URL repo's most recent run, for the palette's "latest run" jump. */
export const latestRunQueryOptions = (org: string, repo: string) =>
	queryOptions({
		queryKey: runsQueryKeys.latest(org, repo),
		queryFn: ({ signal }) => getLatestRunId({ data: { org, repo }, signal }),
		staleTime: 15_000,
	});

export const runQueryOptions = (runId: string) =>
	queryOptions({
		queryKey: runsQueryKeys.detail(runId),
		queryFn: ({ signal }) => getRun({ data: { runId }, signal }),
		staleTime: 10_000,
		// Live re-run: poll while the worker streams steps so finished checks
		// appear without a refresh. Stops once the run is terminal.
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			return status === "queued" || status === "running" ? 1_000 : false;
		},
	});
