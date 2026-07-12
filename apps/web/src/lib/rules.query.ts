import { queryOptions } from "@tanstack/react-query";
import {
	getRulesHeaderStats,
	listRepoOptions,
	listRuleConfigViews,
} from "#/lib/rules.functions";

export const rulesQueryKeys = {
	all: ["rules"] as const,
	repos: () => [...rulesQueryKeys.all, "repos"] as const,
	configs: () => [...rulesQueryKeys.all, "configs"] as const,
	config: (repoId: string) => [...rulesQueryKeys.configs(), repoId] as const,
	stats: () => [...rulesQueryKeys.all, "stats"] as const,
	stat: (repoId: string) => [...rulesQueryKeys.stats(), repoId] as const,
};

export const repoOptionsQueryOptions = () =>
	queryOptions({
		queryKey: rulesQueryKeys.repos(),
		queryFn: ({ signal }) => listRepoOptions({ signal }),
		staleTime: 60_000,
	});

export const ruleConfigsQueryOptions = (repoId: string) =>
	queryOptions({
		queryKey: rulesQueryKeys.config(repoId),
		queryFn: ({ signal }) => listRuleConfigViews({ data: { repoId }, signal }),
		staleTime: 15_000,
		enabled: repoId !== "",
	});

export const rulesStatsQueryOptions = (repoId: string) =>
	queryOptions({
		queryKey: rulesQueryKeys.stat(repoId),
		queryFn: ({ signal }) => getRulesHeaderStats({ data: { repoId }, signal }),
		staleTime: 15_000,
		enabled: repoId !== "",
	});
