import type { QueryClient } from "@tanstack/react-query";
import type { OnboardingStep } from "@tripwire/contracts";
import type { OnboardingState } from "#/lib/onboarding-flow.functions";
import {
	onboardingLatestRunQueryOptions,
	onboardingReportedQueryOptions,
	onboardingReposQueryOptions,
	onboardingWorkflowQueryOptions,
} from "#/lib/onboarding-flow.query";
import { myOrgsQueryOptions } from "#/lib/org.query";
import {
	orgResponseDefaultsQueryOptions,
	responseConfigQueryOptions,
} from "#/lib/response.query";
import {
	ruleConfigsQueryOptions,
	rulesStatsQueryOptions,
} from "#/lib/rules.query";
import { runQueryOptions } from "#/lib/runs.query";

/**
 * Loads what a step's preview page shows before the user gets there. A page
 * that renders complete on the first frame of the slide rides in smoothly;
 * one whose data lands mid-slide renders its heavy body while moving and
 * drops frames.
 */
export async function prefetchStepPreview(
	step: OnboardingStep,
	queryClient: QueryClient,
	state: OnboardingState,
): Promise<void> {
	const org = state.orgSlug ?? state.personalOrgSlug ?? "";
	const repo = state.repo;
	if (org === "") {
		return;
	}
	switch (step) {
		case "workspace":
			await queryClient.prefetchQuery(myOrgsQueryOptions());
			return;
		case "connect":
			await queryClient.prefetchQuery(onboardingReposQueryOptions(org));
			return;
		case "rules":
			if (repo) {
				await Promise.all([
					queryClient.prefetchQuery(ruleConfigsQueryOptions(org, repo.id)),
					queryClient.prefetchQuery(rulesStatsQueryOptions(org, repo.id)),
				]);
			}
			return;
		case "check":
			if (repo && state.answers.reported.length > 0) {
				const reported = await queryClient.fetchQuery(
					onboardingReportedQueryOptions(org, repo.id, state.answers.reported),
				);
				const runId = reported.findLast(
					(changeRequest) => changeRequest.latestRunId !== null,
				)?.latestRunId;
				if (runId) {
					await queryClient.prefetchQuery(runQueryOptions(runId));
				}
			} else if (repo) {
				const runId = await queryClient.fetchQuery(
					onboardingLatestRunQueryOptions(org, repo.name),
				);
				if (runId) {
					await queryClient.prefetchQuery(runQueryOptions(runId));
				}
			}
			return;
		case "responses":
			if (repo) {
				await Promise.all([
					queryClient.prefetchQuery(responseConfigQueryOptions(org, repo.id)),
					queryClient.prefetchQuery(orgResponseDefaultsQueryOptions(org)),
				]);
			}
			return;
		case "workflow":
			if (repo && state.answers.reported.length > 0) {
				await queryClient.prefetchQuery(
					onboardingWorkflowQueryOptions(org, repo.id, state.answers.reported),
				);
			}
			return;
		default:
			return;
	}
}
