import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { parseLive, subscribeLive, useLiveConnected } from "#/lib/live-stream";
import {
	ensureSetupRun,
	findSetupRun,
	getAgentSetupPrompt,
	type SetupRunState,
} from "#/lib/setup.functions";

export const SETUP_POLL_MS = 5000;

export const setupQueryKeys = {
	all: ["setup"] as const,
	runs: () => [...setupQueryKeys.all, "run"] as const,
	run: (org: string, create: boolean) =>
		[...setupQueryKeys.runs(), org, create] as const,
	prompts: () => [...setupQueryKeys.all, "prompt"] as const,
	prompt: (org: string) => [...setupQueryKeys.prompts(), org] as const,
};

export const setupRunQueryOptions = (org: string, create: boolean) => ({
	queryKey: setupQueryKeys.run(org, create),
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		create
			? ensureSetupRun({ data: { org }, signal })
			: findSetupRun({ data: { org }, signal }),
	staleTime: SETUP_POLL_MS - 1000,
});

export const agentSetupPromptQueryOptions = (org: string) => ({
	queryKey: setupQueryKeys.prompt(org),
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		getAgentSetupPrompt({ data: { org }, signal }),
	staleTime: 60_000,
});

/**
 * Setup progress arrives on the live channel while the stream is open; the
 * card only polls when it is not.
 */
export function useLiveSetup(enabled: boolean): boolean {
	const queryClient = useQueryClient();
	const connected = useLiveConnected();
	useEffect(() => {
		if (!enabled) {
			return;
		}
		return subscribeLive("agent", (data) => {
			const message = parseLive(data);
			if (message?.type !== "setup") {
				return;
			}
			for (const [key, value] of queryClient.getQueriesData<SetupRunState>({
				queryKey: setupQueryKeys.runs(),
			})) {
				if (value?.status === "ready" && value.run.code === message.run.code) {
					queryClient.setQueryData<SetupRunState>(key, {
						status: "ready",
						run: message.run,
					});
				}
			}
		});
	}, [enabled, queryClient]);
	return enabled && connected;
}
