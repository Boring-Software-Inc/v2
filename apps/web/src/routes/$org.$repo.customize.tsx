import { createFileRoute } from "@tanstack/react-router";
import { CustomizePage } from "#/components/customize/customize-page";
import { CustomizePageSkeleton } from "#/components/customize/customize-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/customize")({
	component: CustomizePage,
	pendingComponent: CustomizePageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} · customize`),
			description: "response configuration.",
			noindex: true,
		}),
});
