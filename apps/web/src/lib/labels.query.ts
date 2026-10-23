import { queryOptions } from "@tanstack/react-query";
import { listRepoLabels } from "#/lib/labels.functions";

export const labelsQueryKeys = {
	all: ["labels"] as const,
	lists: () => [...labelsQueryKeys.all, "list"] as const,
	list: (org: string, repoId: string) =>
		[...labelsQueryKeys.lists(), org, repoId] as const,
};

export const repoLabelsQueryOptions = (org: string, repoId: string) =>
	queryOptions({
		queryKey: labelsQueryKeys.list(org, repoId),
		queryFn: ({ signal }) => listRepoLabels({ data: { org, repoId }, signal }),
		staleTime: 60_000,
		enabled: repoId !== "",
	});
