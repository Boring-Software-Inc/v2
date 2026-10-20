import { useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import {
	type RepoMatchStatus,
	type RepoTab,
	repoMatchStatus,
	repoTabForLocation,
} from "#/components/tabs/repo-tabs-state";

const SEPARATOR = " ";

export interface RepoTabRoute {
	tab: RepoTab | null;
	status: RepoMatchStatus;
}

export function useRepoTabRoute(): RepoTabRoute {
	const key = useRouterState({
		select: (state) => {
			const match = state.matches.find(
				(candidate) => candidate.routeId === "/$org/$repo",
			);
			const params = match?.params as
				| { org?: string; repo?: string }
				| undefined;
			if (!params?.org || !params.repo) {
				return "";
			}
			return `${params.org}/${params.repo}${SEPARATOR}${state.location.pathname}${SEPARATOR}${repoMatchStatus(match?.status)}`;
		},
	});

	return useMemo(() => {
		const [id, path, status] = key.split(SEPARATOR);
		if (!id || !path) {
			return { tab: null, status: "pending" };
		}
		const [org, repo] = id.split("/");
		return {
			tab: repoTabForLocation(org, repo, path),
			status: (status as RepoMatchStatus) ?? "pending",
		};
	}, [key]);
}

export function useRepoTabTarget(): RepoTab | null {
	const { tab, status } = useRepoTabRoute();
	return status === "ok" ? tab : null;
}
