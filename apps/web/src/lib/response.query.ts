import { queryOptions } from "@tanstack/react-query";
import { getRepoResponseConfig } from "#/lib/response.functions";

export const responseQueryKeys = {
	all: ["response"] as const,
	configs: () => [...responseQueryKeys.all, "config"] as const,
	config: (org: string, repoId: string) =>
		[...responseQueryKeys.configs(), org, repoId] as const,
};

export const responseConfigQueryOptions = (org: string, repoId: string) =>
	queryOptions({
		queryKey: responseQueryKeys.config(org, repoId),
		queryFn: ({ signal }) =>
			getRepoResponseConfig({ data: { org, repoId }, signal }),
		staleTime: 15_000,
		enabled: repoId !== "",
	});
