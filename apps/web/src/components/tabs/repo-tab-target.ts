import { useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import {
	type RepoTab,
	repoTabForLocation,
} from "#/components/tabs/repo-tabs-state";

const SEPARATOR = " ";

/**
 * The repo the current URL is inside, derived from the MATCHED route tree
 * rather than the pathname. `/$org/$repo` is the only route id that carries a
 * repo, so `/acme/settings`, `/acme/home` and `/admin/orgs` can never be
 * mistaken for one — a pathname regex would open a tab for all three.
 *
 * Every page under a repo (`/rules`, `/workflows/$workflowId`, …) matches the
 * same `/$org/$repo` layout route, so moving around inside a repo collapses
 * onto one tab instead of spawning one per page.
 */
export function useRepoTabTarget(): RepoTab | null {
	// The repo and the pathname MUST come out of one selector, and are only
	// trusted when they agree (see `repoTabForLocation`) — read apart, or read
	// mid-commit, they describe two different pages.
	//
	// Selected as a string, not an object: `useRouterState` compares the
	// selection by reference, so a fresh object every router tick would
	// re-render on every router tick.
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
			return `${params.org}/${params.repo}${SEPARATOR}${state.location.pathname}`;
		},
	});

	return useMemo(() => {
		const [id, path] = key.split(SEPARATOR);
		if (!id || !path) {
			return null;
		}
		const [org, repo] = id.split("/");
		return repoTabForLocation(org, repo, path);
	}, [key]);
}
