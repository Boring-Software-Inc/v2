import { queryOptions } from "@tanstack/react-query";
import { scheduleTimings, type WorkflowDefinition } from "@tripwire/contracts";
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

export function followsSchedule(
	data: { enabled: boolean; definition: WorkflowDefinition } | null | undefined,
): boolean {
	return Boolean(data?.enabled && scheduleTimings(data.definition).size > 0);
}

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
		refetchInterval: ({ state }) =>
			followsSchedule(state.data) ? 60_000 : false,
		refetchOnWindowFocus: ({ state }) =>
			followsSchedule(state.data) ? "always" : true,
		enabled: repoId !== "",
	});
