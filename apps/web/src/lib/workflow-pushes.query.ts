import { queryOptions } from "@tanstack/react-query";
import { getWorkflowPushReview } from "#/lib/workflow-pushes.functions";

export const workflowPushQueryKeys = {
	all: ["workflow-pushes"] as const,
	details: () => [...workflowPushQueryKeys.all, "detail"] as const,
	detail: (org: string, repo: string, pushId: string) =>
		[...workflowPushQueryKeys.details(), org, repo, pushId] as const,
};

export const workflowPushReviewQueryOptions = (
	org: string,
	repo: string,
	pushId: string,
) =>
	queryOptions({
		queryKey: workflowPushQueryKeys.detail(org, repo, pushId),
		queryFn: ({ signal }) =>
			getWorkflowPushReview({ data: { org, repo, pushId }, signal }),
		staleTime: 5_000,
		refetchOnWindowFocus: "always",
	});
