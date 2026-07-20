import { createFileRoute } from "@tanstack/react-router";
import { AdminUsersPage } from "#/components/admin/admin-users-page";
import { AdminUsersPageSkeleton } from "#/components/admin/admin-users-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/admin/users")({
	component: AdminUsersPage,
	pendingComponent: AdminUsersPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Admin · users"),
			description: "beta access review.",
			noindex: true,
		}),
});
