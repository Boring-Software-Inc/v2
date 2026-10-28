import {
	listForgeConnections,
	listOrganizationForgeConnections,
} from "#/lib/connections.functions";

export const organizationConnectionsQueryOptions = (org: string) => ({
	queryKey: ["connections", "org", org] as const,
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		listOrganizationForgeConnections({ data: { org }, signal }),
	staleTime: 2_000,
});

/** Its own module so the connect grid can read link status without importing
 * the connections pane — which imports the grid's dialog (§9: no cycles). */
export const connectionsQueryOptions = () => ({
	queryKey: ["connections", "list"] as const,
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		listForgeConnections({ signal }),
	staleTime: 30_000,
});
