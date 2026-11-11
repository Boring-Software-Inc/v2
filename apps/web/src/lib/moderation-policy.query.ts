import { queryOptions } from "@tanstack/react-query";
import {
	getOrgModerationPolicy,
	getRepoModerationSettings,
} from "#/lib/moderation-policy.functions";

export const moderationPolicyQueryOptions = (org: string) =>
	queryOptions({
		queryKey: ["moderation-policy", org] as const,
		queryFn: ({ signal }) => getOrgModerationPolicy({ data: { org }, signal }),
		staleTime: 15_000,
	});

export const repoModerationQueryOptions = (org: string, repo: string) =>
	queryOptions({
		queryKey: [...moderationPolicyQueryOptions(org).queryKey, repo] as const,
		queryFn: ({ signal }) =>
			getRepoModerationSettings({ data: { org, repo }, signal }),
		staleTime: 15_000,
	});
