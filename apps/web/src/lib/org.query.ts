import { queryOptions } from "@tanstack/react-query";
import { getOrgHomeState } from "#/lib/onboarding.functions";
import {
	getOrgAnalyticsSummary,
	getOrgCascade,
	getOrgContext,
	getOrgRepoContext,
	listMyOrgs,
	listOrgInvites,
	listOrgMembers,
} from "#/lib/org.functions";

/**
 * Org-scoped query keys (§9): the org slug (and repo name) from the URL are
 * IN the key — navigation is a cache key change, never a server-side scope
 * mutation.
 */
export const orgQueryKeys = {
	all: ["orgs"] as const,
	mine: () => [...orgQueryKeys.all, "mine"] as const,
	detail: (org: string) => [...orgQueryKeys.all, "detail", org] as const,
	home: (org: string) => [...orgQueryKeys.detail(org), "home"] as const,
	analytics: (org: string) =>
		[...orgQueryKeys.detail(org), "analytics"] as const,
	members: (org: string) => [...orgQueryKeys.detail(org), "members"] as const,
	invites: (org: string) => [...orgQueryKeys.detail(org), "invites"] as const,
	cascade: (org: string) => [...orgQueryKeys.detail(org), "cascade"] as const,
	repo: (org: string, repo: string) =>
		[...orgQueryKeys.detail(org), "repo", repo] as const,
};

export const myOrgsQueryOptions = () =>
	queryOptions({
		queryKey: orgQueryKeys.mine(),
		queryFn: ({ signal }) => listMyOrgs({ signal }),
		staleTime: 60_000,
	});

export const orgContextQueryOptions = (org: string) =>
	queryOptions({
		queryKey: orgQueryKeys.detail(org),
		queryFn: ({ signal }) => getOrgContext({ data: { org }, signal }),
		staleTime: 60_000,
	});

export const orgHomeQueryOptions = (org: string) =>
	queryOptions({
		queryKey: orgQueryKeys.home(org),
		queryFn: ({ signal }) => getOrgHomeState({ data: { org }, signal }),
		staleTime: 15_000,
	});

export const orgAnalyticsQueryOptions = (org: string) =>
	queryOptions({
		queryKey: orgQueryKeys.analytics(org),
		queryFn: ({ signal }) => getOrgAnalyticsSummary({ data: { org }, signal }),
		staleTime: 30_000,
	});

export const orgMembersQueryOptions = (org: string) =>
	queryOptions({
		queryKey: orgQueryKeys.members(org),
		queryFn: ({ signal }) => listOrgMembers({ data: { org }, signal }),
		staleTime: 15_000,
	});

export const orgInvitesQueryOptions = (org: string) =>
	queryOptions({
		queryKey: orgQueryKeys.invites(org),
		queryFn: ({ signal }) => listOrgInvites({ data: { org }, signal }),
		staleTime: 15_000,
	});

export const orgCascadeQueryOptions = (org: string) =>
	queryOptions({
		queryKey: orgQueryKeys.cascade(org),
		queryFn: ({ signal }) => getOrgCascade({ data: { org }, signal }),
		staleTime: 60_000,
	});

export const orgRepoQueryOptions = (org: string, repo: string) =>
	queryOptions({
		queryKey: orgQueryKeys.repo(org, repo),
		queryFn: ({ signal }) => getOrgRepoContext({ data: { org, repo }, signal }),
		staleTime: 30_000,
	});
