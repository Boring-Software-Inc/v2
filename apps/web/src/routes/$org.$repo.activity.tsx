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
			title: formatPageTitle(`${params.repo} · Activity`),
			description: "Every change request in this repo and its verdict.",
			noindex: true,
		}),
});
