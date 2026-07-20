import { createFileRoute } from "@tanstack/react-router";
import { OrgAnalyticsPage } from "#/components/organizations/org-analytics-page";
import { OrgAnalyticsPageSkeleton } from "#/components/organizations/org-analytics-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/analytics")({
	component: OrgAnalyticsPage,
	pendingComponent: OrgAnalyticsPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.org} · analytics`),
			description: "org-level totals across repos.",
			noindex: true,
		}),
});
