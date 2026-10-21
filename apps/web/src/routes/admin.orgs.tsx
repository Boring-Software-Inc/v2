import { createFileRoute } from "@tanstack/react-router";
import { AdminOrgsPage } from "#/components/admin/admin-orgs-page";
import { AdminOrgsPageSkeleton } from "#/components/admin/admin-orgs-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/admin/orgs")({
	component: AdminOrgsPage,
	pendingComponent: AdminOrgsPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Admin | Orgs"),
			description: "Every org on the platform.",
			noindex: true,
		}),
});
