import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
	checkOrgSlug,
	getOnboarding,
	listOnboardingChangeRequests,
	listOnboardingRepos,
	previewOnboardingWorkflow,
} from "#/lib/onboarding-flow.functions";

/** First-run onboarding query keys (§9). */
export const onboardingFlowKeys = {
	all: ["onboarding-flow"] as const,
	state: () => [...onboardingFlowKeys.all, "state"] as const,
	slug: (slug: string) => [...onboardingFlowKeys.all, "slug", slug] as const,
	repos: (org: string) => [...onboardingFlowKeys.all, "repos", org] as const,
	latestRun: (org: string, repo: string) =>
		[...onboardingFlowKeys.all, "latest-run", org, repo] as const,
	changeRequests: (org: string, repoId: string, query: string) =>
		[...onboardingFlowKeys.all, "change-requests", org, repoId, query] as const,
	workflow: (org: string, repoId: string, numbers: readonly number[]) =>
		[...onboardingFlowKeys.all, "workflow", org, repoId, ...numbers] as const,
};

export const onboardingStateQueryOptions = () =>
	queryOptions({
		queryKey: onboardingFlowKeys.state(),
		queryFn: ({ signal }) => getOnboarding({ signal }),
		staleTime: 30_000,
	});

export const orgSlugCheckQueryOptions = (slug: string) =>
	queryOptions({
		queryKey: onboardingFlowKeys.slug(slug),
		queryFn: ({ signal }) => checkOrgSlug({ data: { slug }, signal }),
		staleTime: 15_000,
		placeholderData: keepPreviousData,
	});

export const onboardingChangeRequestsQueryOptions = (
	org: string,
	repoId: string,
	query: string,
) =>
	queryOptions({
		queryKey: onboardingFlowKeys.changeRequests(org, repoId, query),
		queryFn: ({ signal }) =>
			listOnboardingChangeRequests({ data: { org, repoId, query }, signal }),
		staleTime: 15_000,
		placeholderData: keepPreviousData,
	});

export const onboardingWorkflowQueryOptions = (
	org: string,
	repoId: string,
	numbers: readonly number[],
) =>
	queryOptions({
		queryKey: onboardingFlowKeys.workflow(org, repoId, numbers),
		queryFn: ({ signal }) =>
			previewOnboardingWorkflow({
				data: { org, repoId, numbers: [...numbers] },
				signal,
			}),
		staleTime: 10_000,
	});

export const onboardingReposQueryOptions = (org: string) =>
	queryOptions({
		queryKey: onboardingFlowKeys.repos(org),
		queryFn: ({ signal }) => listOnboardingRepos({ data: { org }, signal }),
		staleTime: 5_000,
	});
