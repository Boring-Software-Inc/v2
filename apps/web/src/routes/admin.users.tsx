import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { AdminUsersPage } from "#/components/admin/admin-users-page";
import { AdminUsersPageSkeleton } from "#/components/admin/admin-users-page-skeleton";
import {
	ADMIN_USERS_SEARCH_DEFAULTS,
	adminUsersSearchSchema,
} from "#/lib/admin-search";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/admin/users")({
	validateSearch: adminUsersSearchSchema,
	search: { middlewares: [stripSearchParams(ADMIN_USERS_SEARCH_DEFAULTS)] },
	component: AdminUsersPage,
	pendingComponent: AdminUsersPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Admin | Users"),
			description: "Review beta access requests.",
			noindex: true,
		}),
});
