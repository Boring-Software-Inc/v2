import { createFileRoute } from "@tanstack/react-router";
import { ORG_REPOS_COLLECTION } from "#/components/organizations/org-home-collection";
import { OrgHomePage } from "#/components/organizations/org-home-page";
import { OrgHomePageSkeleton } from "#/components/organizations/org-home-page-skeleton";
import { collectionSearchSchema } from "#/lib/collection";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/home")({
	validateSearch: collectionSearchSchema(ORG_REPOS_COLLECTION),
	component: OrgHomePage,
	pendingComponent: OrgHomePageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(params.org),
			description: "The repos this org protects and their status.",
			noindex: true,
		}),
});
