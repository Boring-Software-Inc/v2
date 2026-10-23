import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { AnalyticsPage } from "#/components/analytics/analytics-page";
import { AnalyticsPageSkeleton } from "#/components/analytics/analytics-page-skeleton";
import {
	ANALYTICS_SEARCH_DEFAULTS,
	analyticsSearchSchema,
} from "#/lib/repo-search";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/analytics")({
	staticData: { region: "analytics" },
	validateSearch: analyticsSearchSchema,
	search: { middlewares: [stripSearchParams(ANALYTICS_SEARCH_DEFAULTS)] },
	component: AnalyticsPage,
	pendingComponent: AnalyticsPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} | Analytics`),
			description: "Verdicts and trends for this repo.",
			noindex: true,
		}),
});
