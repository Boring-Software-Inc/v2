import { queryOptions } from "@tanstack/react-query";
import {
	getOrgResponseDefaults,
	getRepoResponseConfig,
	searchCloseGifs,
} from "#/lib/response.functions";

export const responseQueryKeys = {
	all: ["response"] as const,
	configs: () => [...responseQueryKeys.all, "config"] as const,
	config: (org: string, repoId: string) =>
		[...responseQueryKeys.configs(), org, repoId] as const,
	orgDefaults: (org: string) =>
		[...responseQueryKeys.all, "org-defaults", org] as const,
	gifs: (org: string, query: string, offset: number) =>
		[...responseQueryKeys.all, "gifs", org, query, offset] as const,
};

export const responseConfigQueryOptions = (org: string, repoId: string) =>
	queryOptions({
		queryKey: responseQueryKeys.config(org, repoId),
		queryFn: ({ signal }) =>
			getRepoResponseConfig({ data: { org, repoId }, signal }),
		staleTime: 15_000,
		enabled: repoId !== "",
	});

export const orgResponseDefaultsQueryOptions = (org: string) =>
	queryOptions({
		queryKey: responseQueryKeys.orgDefaults(org),
		queryFn: ({ signal }) => getOrgResponseDefaults({ data: { org }, signal }),
		staleTime: 30_000,
	});

export const closeGifsQueryOptions = (
	org: string,
	query: string,
	offset: number,
) =>
	queryOptions({
		queryKey: responseQueryKeys.gifs(org, query, offset),
		queryFn: ({ signal }) =>
			searchCloseGifs({ data: { org, query, offset }, signal }),
		staleTime: 10 * 60_000,
	});
