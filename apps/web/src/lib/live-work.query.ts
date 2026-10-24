import { useQueryClient } from "@tanstack/react-query";
import type { WorkflowWork } from "@tripwire/contracts";
import { useEffect } from "react";
import { onLiveResync, parseLive, subscribeLive } from "#/lib/live-stream";
import { mergeWorkIntoCards, mergeWorkIntoDetail } from "#/lib/live-work";
import type { WorkflowCard, WorkflowDetail } from "#/lib/workflows.functions";
import { workflowsQueryKeys } from "#/lib/workflows.query";

/**
 * Merges agent work for one repo into the workflows list and every open
 * workflow, straight into the Query cache.
 */
export function useLiveWork(org: string, repoId: string): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (repoId === "") {
			return;
		}
		const listKey = workflowsQueryKeys.list(org, repoId);
		const detailPrefix = [...workflowsQueryKeys.details(), org, repoId];
		const apply = (work: WorkflowWork) => {
			const list = mergeWorkIntoCards(
				queryClient.getQueryData<WorkflowCard[]>(listKey),
				work,
			);
			if (list.data) {
				queryClient.setQueryData(listKey, list.data);
			}
			if (list.refetch) {
				queryClient.invalidateQueries({ queryKey: listKey });
			}
			for (const [
				key,
				value,
			] of queryClient.getQueriesData<WorkflowDetail | null>({
				queryKey: detailPrefix,
			})) {
				const detail = mergeWorkIntoDetail(value, work);
				if (detail.data !== value && detail.data) {
					queryClient.setQueryData(key, detail.data);
				}
				if (detail.refetch) {
					queryClient.invalidateQueries({ queryKey: key });
				}
			}
		};
		const off = subscribeLive("agent", (data) => {
			const message = parseLive(data);
			if (message?.type === "work" && message.work.repoId === repoId) {
				apply(message.work);
			}
		});
		const offResync = onLiveResync(() => {
			queryClient.invalidateQueries({ queryKey: listKey });
			queryClient.invalidateQueries({ queryKey: detailPrefix });
		});
		return () => {
			offResync();
			off();
		};
	}, [org, repoId, queryClient]);
}
