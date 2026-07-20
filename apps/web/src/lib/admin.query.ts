import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { AccessStatus } from "@tripwire/contracts";
import {
	getAdminOverview,
	listAdminOrgMembers,
	listAdminOrgs,
	listAdminUsers,
} from "#/lib/admin.functions";

export interface AdminUsersFilter {
	status?: AccessStatus;
	search?: string;
	offset?: number;
}

export interface AdminOrgsFilter {
	kind?: "personal" | "team";
	search?: string;
	offset?: number;
}

export const adminQueryKeys = {
	all: ["admin"] as const,
	overview: () => [...adminQueryKeys.all, "overview"] as const,
	users: (filter: AdminUsersFilter) =>
		[...adminQueryKeys.all, "users", filter] as const,
	usersAll: () => [...adminQueryKeys.all, "users"] as const,
	orgs: (filter: AdminOrgsFilter) =>
		[...adminQueryKeys.all, "orgs", filter] as const,
	orgsAll: () => [...adminQueryKeys.all, "orgs"] as const,
	orgMembers: (orgId: string) =>
		[...adminQueryKeys.all, "org-members", orgId] as const,
};

export const ADMIN_PAGE_SIZE = 50;

export const adminOverviewQueryOptions = () =>
	queryOptions({
		queryKey: adminQueryKeys.overview(),
		queryFn: ({ signal }) => getAdminOverview({ signal }),
		staleTime: 30_000,
	});

export const adminUsersQueryOptions = (filter: AdminUsersFilter) =>
	queryOptions({
		queryKey: adminQueryKeys.users(filter),
		queryFn: ({ signal }) =>
			listAdminUsers({
				data: { ...filter, limit: ADMIN_PAGE_SIZE },
				signal,
			}),
		staleTime: 15_000,
		placeholderData: keepPreviousData,
	});

export const adminOrgsQueryOptions = (filter: AdminOrgsFilter) =>
	queryOptions({
		queryKey: adminQueryKeys.orgs(filter),
		queryFn: ({ signal }) =>
			listAdminOrgs({
				data: { ...filter, limit: ADMIN_PAGE_SIZE },
				signal,
			}),
		staleTime: 15_000,
		placeholderData: keepPreviousData,
	});

export const adminOrgMembersQueryOptions = (orgId: string) =>
	queryOptions({
		queryKey: adminQueryKeys.orgMembers(orgId),
		queryFn: ({ signal }) => listAdminOrgMembers({ data: { orgId }, signal }),
		staleTime: 15_000,
		enabled: orgId !== "",
	});
