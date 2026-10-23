import {
	type QueryKey,
	type UseQueryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

const POLL_MS = 2_000;
const WAIT_MS = 30_000;

export interface SyncedView {
	syncedAt: string | null;
	syncing: boolean;
}

export interface SyncedList<View extends SyncedView> {
	data: View | undefined;
	loading: boolean;
	syncing: boolean;
	refresh: () => void;
}

export function useSyncedList<View extends SyncedView, Key extends QueryKey>(
	options: UseQueryOptions<View, Error, View, Key> & { queryKey: Key },
	refreshFn: () => Promise<{ queued: boolean }>,
): SyncedList<View> {
	const queryClient = useQueryClient();
	const [openedAt] = useState(Date.now);
	const [waiting, setWaiting] = useState<{
		since: string | null;
		until: number;
	} | null>(null);
	const pending = (view: View | undefined) =>
		(view?.syncing === true && Date.now() < openedAt + WAIT_MS) ||
		(waiting !== null &&
			(view?.syncedAt ?? null) === waiting.since &&
			Date.now() < waiting.until);
	const { data, isPending } = useQuery({
		...options,
		refetchInterval: (query) => (pending(query.state.data) ? POLL_MS : false),
	});
	const mutation = useMutation({
		mutationFn: refreshFn,
		onSuccess: (result) => {
			if (result.queued) {
				setWaiting({
					since: data?.syncedAt ?? null,
					until: Date.now() + WAIT_MS,
				});
			}
		},
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: options.queryKey }),
	});
	const syncing = mutation.isPending || pending(data);
	return {
		data,
		loading: options.enabled !== false && (isPending || syncing),
		syncing,
		refresh: () => mutation.mutate(),
	};
}
