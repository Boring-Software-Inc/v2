import { queryOptions } from "@tanstack/react-query";
import {
	getCurrentUser,
	getProviderAvailability,
	getSessionInfo,
} from "#/lib/auth.functions";

export const authQueryKeys = {
	all: ["auth"] as const,
	currentUser: () => [...authQueryKeys.all, "current-user"] as const,
	session: () => [...authQueryKeys.all, "session"] as const,
	providers: () => [...authQueryKeys.all, "providers"] as const,
};

export const providerAvailabilityQueryOptions = () =>
	queryOptions({
		queryKey: authQueryKeys.providers(),
		queryFn: ({ signal }) => getProviderAvailability({ signal }),
		staleTime: 5 * 60_000,
	});

export const sessionInfoQueryOptions = () =>
	queryOptions({
		queryKey: authQueryKeys.session(),
		queryFn: ({ signal }) => getSessionInfo({ signal }),
		staleTime: 5 * 60_000,
	});

export const currentUserQueryOptions = () =>
	queryOptions({
		queryKey: authQueryKeys.currentUser(),
		queryFn: ({ signal }) => getCurrentUser({ signal }),
		staleTime: 5 * 60_000,
	});
