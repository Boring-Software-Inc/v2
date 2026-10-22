import { queryOptions } from "@tanstack/react-query";
import { listRepoReviewers } from "#/lib/reviewers.functions";

export const reviewersQueryKeys = {
	all: ["reviewers"] as const,
	lists: () => [...reviewersQueryKeys.all, "list"] as const,
	list: (org: string, repoId: string) =>
		[...reviewersQueryKeys.lists(), org, repoId] as const,
};

export const repoReviewersQueryOptions = (org: string, repoId: string) =>
	queryOptions({
		queryKey: reviewersQueryKeys.list(org, repoId),
		queryFn: ({ signal }) =>
			listRepoReviewers({ data: { org, repoId }, signal }),
		staleTime: 60_000,
		enabled: repoId !== "",
	});
