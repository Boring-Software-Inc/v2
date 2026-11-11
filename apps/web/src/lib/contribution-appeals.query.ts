import { queryOptions } from "@tanstack/react-query";
import {
	getContributionAppeal,
	getContributionAppealPortal,
	listContributionAppeals,
} from "#/lib/contribution-appeals.functions";

export function contributionAppealPortalOptions(org: string) {
	return queryOptions({
		queryKey: ["contribution-appeal-portal", org],
		queryFn: ({ signal }) =>
			getContributionAppealPortal({ data: { org }, signal }),
		staleTime: 10_000,
		refetchInterval: (query) =>
			query.state.data?.state === "signed-in" &&
			(query.state.data.pendingRunId || query.state.data.pendingOrgSlug)
				? 15_000
				: false,
	});
}

export function contributionAppealOptions(runId: string) {
	return queryOptions({
		queryKey: ["contribution-appeal", runId],
		queryFn: () => getContributionAppeal({ data: { runId } }),
		refetchInterval: (query) =>
			query.state.data?.state === "eligible" &&
			(query.state.data.status === "pending" ||
				query.state.data.pendingRunId !== null ||
				query.state.data.pendingOrgSlug !== null)
				? 15_000
				: false,
	});
}

export function contributionAppealsOptions(org: string, repo: string) {
	return queryOptions({
		queryKey: ["contribution-appeals", org, repo],
		queryFn: () => listContributionAppeals({ data: { org, repo } }),
		refetchInterval: 15_000,
	});
}
