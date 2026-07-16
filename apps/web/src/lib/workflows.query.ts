import { queryOptions } from "@tanstack/react-query";
import { getRepoWorkflow, listRepoWorkflows } from "#/lib/workflows.functions";

export const workflowsQueryKeys = {
	all: ["workflows"] as const,
	lists: () => [...workflowsQueryKeys.all, "list"] as const,
	list: (org: string, repoId: string) =>
		[...workflowsQueryKeys.lists(), org, repoId] as const,
	details: () => [...workflowsQueryKeys.all, "detail"] as const,
	detail: (org: string, repoId: string, workflowId: string) =>
		[...workflowsQueryKeys.details(), org, repoId, workflowId] as const,
};

export const workflowsListQueryOptions = (org: string, repoId: string) =>
	queryOptions({
		queryKey: workflowsQueryKeys.list(org, repoId),
		queryFn: ({ signal }) =>
			listRepoWorkflows({ data: { org, repoId }, signal }),
		staleTime: 15_000,
		enabled: repoId !== "",
	});

export const workflowDetailQueryOptions = (
	org: string,
	repoId: string,
	workflowId: string,
) =>
	queryOptions({
		queryKey: workflowsQueryKeys.detail(org, repoId, workflowId),
		queryFn: ({ signal }) =>
			getRepoWorkflow({ data: { org, repoId, workflowId }, signal }),
		staleTime: 10_000,
		enabled: repoId !== "",
	});
