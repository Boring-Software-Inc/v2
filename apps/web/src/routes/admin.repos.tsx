import { createFileRoute } from "@tanstack/react-router";
import { AdminReposPage } from "#/components/admin/admin-repos-page";
import { AdminReposPageSkeleton } from "#/components/admin/admin-repos-page-skeleton";
import { adminReposSearchSchema } from "#/lib/admin-search";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/admin/repos")({
	validateSearch: adminReposSearchSchema,
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
