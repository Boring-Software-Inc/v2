import {
	getConsentRequest,
	getDeviceRequest,
	listConnectedAgents,
} from "#/lib/agents.functions";

export const agentQueryKeys = {
	all: ["agents"] as const,
	lists: () => [...agentQueryKeys.all, "list"] as const,
	requests: () => [...agentQueryKeys.all, "request"] as const,
	consent: () => [...agentQueryKeys.requests(), "consent"] as const,
	device: (userCode: string) =>
		[...agentQueryKeys.requests(), "device", userCode] as const,
};

export const connectedAgentsQueryOptions = () => ({
	queryKey: agentQueryKeys.lists(),
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		listConnectedAgents({ signal }),
	staleTime: 30_000,
});

export function rawOAuthQuery(): string {
	return window.location.search.replace(/^\?/, "");
}

export const consentRequestQueryOptions = () => ({
	queryKey: agentQueryKeys.consent(),
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		getConsentRequest({ data: { oauthQuery: rawOAuthQuery() }, signal }),
	staleTime: Number.POSITIVE_INFINITY,
});

export const deviceRequestQueryOptions = (userCode: string) => ({
	queryKey: agentQueryKeys.device(userCode),
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		getDeviceRequest({ data: { userCode }, signal }),
	staleTime: Number.POSITIVE_INFINITY,
});
