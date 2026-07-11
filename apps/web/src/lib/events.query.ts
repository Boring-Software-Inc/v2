import { queryOptions, useQueryClient } from "@tanstack/react-query";
import type { NormalizedEvent } from "@tripwire/contracts";
import { useEffect } from "react";
import { type EventsPageData, getEvents } from "#/lib/events.functions";

export const eventsQueryKeys = {
	all: ["events"] as const,
	lists: () => [...eventsQueryKeys.all, "list"] as const,
	list: () => [...eventsQueryKeys.lists(), "live"] as const,
};

export const eventsQueryOptions = () =>
	queryOptions({
		queryKey: eventsQueryKeys.list(),
		queryFn: ({ signal }) => getEvents({ data: {}, signal }),
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});

const MAX_LIVE_ITEMS = 200;

function apiUrl(): string {
	return import.meta.env.VITE_API_URL ?? "http://localhost:8787";
}

/**
 * §9: the SSE stream merges into the Query cache — the live event list is a
 * cache update, not a parallel state system. This effect exists to sync an
 * EXTERNAL push source (EventSource) into the cache; that is the one job
 * effects are for.
 */
export function useEventStream(enabled = true): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!enabled) {
			return;
		}
		const source = new EventSource(`${apiUrl()}/events/stream`);
		source.addEventListener("event", (message) => {
			const incoming = JSON.parse(message.data) as NormalizedEvent;
			queryClient.setQueryData<EventsPageData>(
				eventsQueryKeys.list(),
				(current) => {
					if (!current) {
						return { items: [incoming], nextCursor: null };
					}
					if (current.items.some((event) => event.id === incoming.id)) {
						return current;
					}
					return {
						...current,
						items: [incoming, ...current.items].slice(0, MAX_LIVE_ITEMS),
					};
				},
			);
		});
		return () => source.close();
	}, [enabled, queryClient]);
}
