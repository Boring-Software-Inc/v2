import {
	ensureSetupRun,
	findSetupRun,
	getAgentSetupPrompt,
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
