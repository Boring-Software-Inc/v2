import { queryOptions } from "@tanstack/react-query";
import {
	getContributionAppeal,
	listContributionAppeals,
} from "#/lib/contribution-appeals.functions";

export function contributionAppealOptions(runId: string) {
	return queryOptions({
		queryKey: ["contribution-appeal", runId],
		queryFn: () => getContributionAppeal({ data: { runId } }),
		refetchInterval: (query) =>
			query.state.data?.state === "eligible" &&
			query.state.data.status === "pending"
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
