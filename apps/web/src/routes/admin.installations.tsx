import { createFileRoute } from "@tanstack/react-router";
import { AdminInstallationsPage } from "#/components/admin/admin-installations-page";
import { AdminInstallationsPageSkeleton } from "#/components/admin/admin-installations-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/admin/installations")({
	component: AdminInstallationsPage,
	pendingComponent: AdminInstallationsPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Admin | Installations"),
			description: "Every app installation on the platform.",
			noindex: true,
		}),
});
