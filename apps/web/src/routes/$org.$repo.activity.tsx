import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { ActivityPage } from "#/components/activity/activity-page";
import { ActivityPageSkeleton } from "#/components/activity/activity-page-skeleton";
import {
	ACTIVITY_SEARCH_DEFAULTS,
	activitySearchSchema,
} from "#/lib/repo-search";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/activity")({
	staticData: { region: "activity" },
	validateSearch: activitySearchSchema,
	search: { middlewares: [stripSearchParams(ACTIVITY_SEARCH_DEFAULTS)] },
	component: ActivityPage,
	pendingComponent: ActivityPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} | Activity`),
			description: "Every change request in this repo and its verdict.",
			noindex: true,
		}),
});
