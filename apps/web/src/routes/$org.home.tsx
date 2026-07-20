import { createFileRoute } from "@tanstack/react-router";
import { OrgHomePage } from "#/components/organizations/org-home-page";
import { OrgHomePageSkeleton } from "#/components/organizations/org-home-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/home")({
	component: OrgHomePage,
	pendingComponent: OrgHomePageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(params.org),
			description: "repos this org protects, with status.",
			noindex: true,
		}),
});
