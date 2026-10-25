import { queryOptions } from "@tanstack/react-query";
import {
	getRepoSuggestions,
	getRuleLibrary,
	getRulesHeaderStats,
	listRuleConfigViews,
} from "#/lib/rules.functions";

export const rulesQueryKeys = {
	all: ["rules"] as const,
	configs: () => [...rulesQueryKeys.all, "configs"] as const,
	config: (org: string, repoId: string) =>
		[...rulesQueryKeys.configs(), org, repoId] as const,
	stats: () => [...rulesQueryKeys.all, "stats"] as const,
	stat: (org: string, repoId: string) =>
		[...rulesQueryKeys.stats(), org, repoId] as const,
	libraries: () => [...rulesQueryKeys.all, "library"] as const,
	library: (org: string, repoId: string) =>
		[...rulesQueryKeys.libraries(), org, repoId] as const,
	suggestions: () => [...rulesQueryKeys.all, "suggestions"] as const,
	suggestion: (org: string, repoId: string, kind: string) =>
		[...rulesQueryKeys.suggestions(), org, repoId, kind] as const,
};

export const ruleConfigsQueryOptions = (org: string, repoId: string) =>
	queryOptions({
		queryKey: rulesQueryKeys.config(org, repoId),
		queryFn: ({ signal }) =>
			listRuleConfigViews({ data: { org, repoId }, signal }),
		staleTime: 15_000,
		enabled: repoId !== "",
	});

export const rulesStatsQueryOptions = (org: string, repoId: string) =>
	queryOptions({
		queryKey: rulesQueryKeys.stat(org, repoId),
		queryFn: ({ signal }) =>
			getRulesHeaderStats({ data: { org, repoId }, signal }),
		staleTime: 15_000,
		enabled: repoId !== "",
	});

export const repoSuggestionsQueryOptions = (
	org: string,
	repoId: string,
	kind: string,
) =>
	queryOptions({
		queryKey: rulesQueryKeys.suggestion(org, repoId, kind),
		queryFn: ({ signal }) =>
			getRepoSuggestions({ data: { org, repoId, kind }, signal }),
		// Branch lists change slowly and the worker refreshes them on push.
		staleTime: 60_000,
		enabled: repoId !== "" && kind !== "",
	});

export const ruleLibraryQueryOptions = (org: string, repoId: string) =>
	queryOptions({
		queryKey: rulesQueryKeys.library(org, repoId),
		queryFn: ({ signal }) => getRuleLibrary({ data: { org, repoId }, signal }),
		staleTime: 60_000,
		refetchInterval: (query) =>
			query.state.data?.preview === null && query.state.dataUpdateCount < 12
				? 5_000
				: false,
		enabled: repoId !== "",
	});
