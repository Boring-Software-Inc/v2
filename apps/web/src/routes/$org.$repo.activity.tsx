import { createFileRoute } from "@tanstack/react-router";
import { ActivityPage } from "#/components/activity/activity-page";
import { ActivityPageSkeleton } from "#/components/activity/activity-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/activity")({
	component: ActivityPage,
	pendingComponent: ActivityPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} · activity`),
			description: "the repo's event feed.",
			noindex: true,
		}),
});
