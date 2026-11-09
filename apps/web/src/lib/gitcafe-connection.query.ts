import { queryOptions } from "@tanstack/react-query";
import {
	getGitCafeConnectionStatus,
	getGitCafeSetupContext,
} from "#/lib/gitcafe-connection.functions";

export const gitCafeConnectionQueryKeys = {
	all: ["onboarding", "gitcafe"] as const,
	contexts: () => [...gitCafeConnectionQueryKeys.all, "context"] as const,
	context: (
		installationId: string,
		state: string | undefined,
		orgId: string | undefined,
	) =>
		[
			...gitCafeConnectionQueryKeys.contexts(),
			installationId,
			state,
			orgId,
		] as const,
	statuses: () => [...gitCafeConnectionQueryKeys.all, "status"] as const,
	status: (org: string, installationId: string, jobId: string) =>
		[
			...gitCafeConnectionQueryKeys.statuses(),
			org,
			installationId,
			jobId,
		] as const,
};

export const gitCafeSetupContextQueryOptions = (
	installationId: string,
	state: string | undefined,
	orgId: string | undefined,
) =>
	queryOptions({
		queryKey: gitCafeConnectionQueryKeys.context(installationId, state, orgId),
		queryFn: ({ signal }) =>
			getGitCafeSetupContext({
				data: { installationId, state, orgId },
				signal,
			}),
		staleTime: 10_000,
	});

export const gitCafeConnectionStatusQueryOptions = (
	org: string,
	installationId: string,
	jobId: string,
) =>
	queryOptions({
		queryKey: gitCafeConnectionQueryKeys.status(org, installationId, jobId),
		queryFn: ({ signal }) =>
			getGitCafeConnectionStatus({
				data: { org, installationId, jobId },
				signal,
			}),
		staleTime: 1000,
	});
