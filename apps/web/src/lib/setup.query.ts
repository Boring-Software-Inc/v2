import { ensureSetupRun, findSetupRun } from "#/lib/setup.functions";

export const SETUP_POLL_MS = 5000;

export const setupQueryKeys = {
	all: ["setup"] as const,
	runs: () => [...setupQueryKeys.all, "run"] as const,
	run: (org: string, create: boolean) =>
		[...setupQueryKeys.runs(), org, create] as const,
};

export const setupRunQueryOptions = (org: string, create: boolean) => ({
	queryKey: setupQueryKeys.run(org, create),
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		create
			? ensureSetupRun({ data: { org }, signal })
			: findSetupRun({ data: { org }, signal }),
	staleTime: SETUP_POLL_MS - 1000,
});
