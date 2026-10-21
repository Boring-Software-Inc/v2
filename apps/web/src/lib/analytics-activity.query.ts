import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getAnalyticsActivity } from "#/lib/analytics-activity.functions";
import type { DateRange } from "#/lib/date-range";

export const analyticsActivityQueryKeys = {
	all: ["analytics-activity"] as const,
	metric: (
		org: string,
		repo: string,
		metric: string,
		range: DateRange | null,
	) =>
		[
			...analyticsActivityQueryKeys.all,
			org,
			repo,
			metric,
			range?.from ?? null,
			range?.to ?? null,
		] as const,
};

export const analyticsActivityQueryOptions = (
	org: string,
	repo: string,
	metric: string,
	range: DateRange | null = null,
) =>
	queryOptions({
		queryKey: analyticsActivityQueryKeys.metric(org, repo, metric, range),
		queryFn: ({ signal }) =>
			getAnalyticsActivity({ data: { org, repo, metric, range }, signal }),
		staleTime: 10_000,
		placeholderData: keepPreviousData,
	});
