import { queryOptions } from "@tanstack/react-query";
import {
	getCostByOrg,
	getEconomicsOverview,
	getEconomicsSeries,
} from "#/lib/admin-economics.functions";

export const economicsQueryKeys = {
	all: ["admin", "economics"] as const,
	overview: () => [...economicsQueryKeys.all, "overview"] as const,
	series: () => [...economicsQueryKeys.all, "series"] as const,
	costByOrg: () => [...economicsQueryKeys.all, "cost-by-org"] as const,
};

export const economicsOverviewQueryOptions = () =>
	queryOptions({
		queryKey: economicsQueryKeys.overview(),
		queryFn: ({ signal }) => getEconomicsOverview({ signal }),
		staleTime: 60_000,
	});

export const economicsSeriesQueryOptions = () =>
	queryOptions({
		queryKey: economicsQueryKeys.series(),
		queryFn: ({ signal }) => getEconomicsSeries({ signal }),
		staleTime: 60_000,
	});

export const economicsCostByOrgQueryOptions = () =>
	queryOptions({
		queryKey: economicsQueryKeys.costByOrg(),
		queryFn: ({ signal }) => getCostByOrg({ signal }),
		staleTime: 60_000,
	});
