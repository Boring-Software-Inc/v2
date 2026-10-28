import { queryOptions } from "@tanstack/react-query";
import { setupProgress } from "#/lib/repo-setup";
import { getRepoSetup } from "#/lib/repo-setup.functions";

export const REPO_SETUP_AGENT_POLL_MS = 5_000;
export const REPO_SETUP_POLL_MS = 15_000;

export const repoSetupQueryKeys = {
	all: ["repo-setup"] as const,
	details: () => [...repoSetupQueryKeys.all, "detail"] as const,
	detail: (org: string, repo: string) =>
		[...repoSetupQueryKeys.details(), org, repo] as const,
};

export const repoSetupQueryOptions = (org: string, repo: string) =>
	queryOptions({
		queryKey: repoSetupQueryKeys.detail(org, repo),
		queryFn: ({ signal }) => getRepoSetup({ data: { org, repo }, signal }),
		staleTime: 10_000,
		enabled: org !== "" && repo !== "",
		refetchInterval: (query) => {
			const state = query.state.data;
			if (!state) {
				return false;
			}
			if (state.agent) {
				return REPO_SETUP_AGENT_POLL_MS;
			}
			return setupProgress(state.facts).complete ? false : REPO_SETUP_POLL_MS;
		},
		refetchIntervalInBackground: false,
	});
