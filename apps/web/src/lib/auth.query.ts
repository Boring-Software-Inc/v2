import { queryOptions } from "@tanstack/react-query";
import {
	getCurrentUser,
	getSessionInfo,
	getSignInProviderIds,
} from "#/lib/auth.functions";

export const authQueryKeys = {
	all: ["auth"] as const,
	currentUser: () => [...authQueryKeys.all, "current-user"] as const,
	session: () => [...authQueryKeys.all, "session"] as const,
	signInProviders: () => [...authQueryKeys.all, "sign-in-providers"] as const,
};

export const signInProviderIdsQueryOptions = () =>
	queryOptions({
		queryKey: authQueryKeys.signInProviders(),
		queryFn: ({ signal }) => getSignInProviderIds({ signal }),
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
