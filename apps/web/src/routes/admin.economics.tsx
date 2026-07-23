import { createFileRoute } from "@tanstack/react-router";
import { EconomicsPage } from "#/components/admin/economics-page";
import { EconomicsPageSkeleton } from "#/components/admin/economics-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/admin/economics")({
	component: EconomicsPage,
	pendingComponent: EconomicsPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Economics"),
			description: "platform unit economics and cost.",
			noindex: true,
		}),
});
