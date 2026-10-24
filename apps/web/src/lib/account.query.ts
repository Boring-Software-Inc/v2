import { queryOptions } from "@tanstack/react-query";
import {
	getAccountDeletionPlan,
	listMySessions,
} from "#/lib/account.functions";

export const accountQueryKeys = {
	all: ["account"] as const,
	sessions: () => [...accountQueryKeys.all, "sessions"] as const,
	deletion: () => [...accountQueryKeys.all, "deletion"] as const,
};

export const accountSessionsQueryOptions = () =>
	queryOptions({
		queryKey: accountQueryKeys.sessions(),
		queryFn: ({ signal }) => listMySessions({ signal }),
		staleTime: 30_000,
	});

export const accountDeletionQueryOptions = () =>
	queryOptions({
		queryKey: accountQueryKeys.deletion(),
		queryFn: ({ signal }) => getAccountDeletionPlan({ signal }),
		staleTime: 0,
	});
