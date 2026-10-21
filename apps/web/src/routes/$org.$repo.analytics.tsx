import { createFileRoute } from "@tanstack/react-router";
import { AnalyticsPage } from "#/components/analytics/analytics-page";
import { AnalyticsPageSkeleton } from "#/components/analytics/analytics-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/analytics")({
	validateSearch: (search: Record<string, unknown>): { metric?: string } =>
		typeof search.metric === "string" ? { metric: search.metric } : {},
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
