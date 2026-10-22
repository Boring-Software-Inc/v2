import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { AdminReposPage } from "#/components/admin/admin-repos-page";
import { AdminReposPageSkeleton } from "#/components/admin/admin-repos-page-skeleton";
import {
	ADMIN_REPOS_SEARCH_DEFAULTS,
	adminReposSearchSchema,
} from "#/lib/admin-search";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/admin/repos")({
	validateSearch: adminReposSearchSchema,
	search: { middlewares: [stripSearchParams(ADMIN_REPOS_SEARCH_DEFAULTS)] },
	component: AdminReposPage,
	pendingComponent: AdminReposPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Admin | Repos"),
			description: "Every connected repo on the platform.",
			noindex: true,
		}),
});
