import { createFileRoute } from "@tanstack/react-router";
import { AdminPilotPage } from "#/components/admin/admin-pilot-page";
import { AdminPilotPageSkeleton } from "#/components/admin/admin-pilot-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/admin/pilot")({
	component: AdminPilotPage,
	pendingComponent: AdminPilotPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Admin | Pilot"),
			description: "Publish reviewed accounts to the public spam blocklist.",
			noindex: true,
		}),
});
