import { queryOptions } from "@tanstack/react-query";
import { adminQueryKeys } from "#/lib/admin.query";
import {
	getAdminUser,
	getAdminUserActivity,
	getAdminUserFlags,
} from "#/lib/staff-users.functions";

export const staffUserQueryKeys = {
	all: () => [...adminQueryKeys.all, "user"] as const,
	detail: (userId: string) => [...staffUserQueryKeys.all(), userId] as const,
	flags: (userId: string) =>
		[...staffUserQueryKeys.detail(userId), "flags"] as const,
	activity: (userId: string) =>
		[...staffUserQueryKeys.detail(userId), "activity"] as const,
};

export const adminUserQueryOptions = (userId: string) =>
	queryOptions({
		queryKey: staffUserQueryKeys.detail(userId),
		queryFn: ({ signal }) => getAdminUser({ data: { userId }, signal }),
		staleTime: 15_000,
	});

export const adminUserFlagsQueryOptions = (userId: string) =>
	queryOptions({
		queryKey: staffUserQueryKeys.flags(userId),
		queryFn: ({ signal }) => getAdminUserFlags({ data: { userId }, signal }),
		staleTime: 10_000,
		refetchInterval: (query) =>
			query.state.data?.rows.some(
				(row) => row.override?.syncStatus === "pending",
			)
				? 3_000
				: false,
	});

export const adminUserActivityQueryOptions = (userId: string) =>
	queryOptions({
		queryKey: staffUserQueryKeys.activity(userId),
		queryFn: ({ signal }) => getAdminUserActivity({ data: { userId }, signal }),
		staleTime: 60_000,
	});
