import { createFileRoute } from "@tanstack/react-router";
import { AdminHomePage } from "#/components/admin/admin-home-page";
import { AdminHomePageSkeleton } from "#/components/admin/admin-home-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/admin/")({
	component: AdminHomePage,
	pendingComponent: AdminHomePageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Admin"),
			description: "platform administration.",
			noindex: true,
		}),
});
