import { queryOptions, useQuery } from "@tanstack/react-query";
import type { DigestHistoryInput } from "@tripwire/contracts";
import { getDigestHistory, getHomeDigest } from "#/lib/home-digest.functions";
import { orgQueryKeys } from "#/lib/org.query";

export const homeDigestQueryKeys = {
	all: (org: string) => [...orgQueryKeys.home(org), "digest"] as const,
};

export const homeDigestQueryOptions = (org: string) =>
	queryOptions({
		queryKey: homeDigestQueryKeys.all(org),
		queryFn: ({ signal }) => getHomeDigest({ data: { org }, signal }),
		staleTime: 15_000,
	});

export function useHomeDigest(org: string, enabled: boolean) {
	return useQuery({ ...homeDigestQueryOptions(org), enabled });
}

export const digestHistoryQueryOptions = (input: DigestHistoryInput) =>
	queryOptions({
		queryKey: [...homeDigestQueryKeys.all(input.org), "history", input],
		queryFn: ({ signal }) => getDigestHistory({ data: input, signal }),
		staleTime: 15_000,
	});
