import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { ResponsesPage } from "#/components/responses/responses-page";
import { ResponsesPageSkeleton } from "#/components/responses/responses-page-skeleton";
import {
	RESPONSES_SEARCH_DEFAULTS,
	responsesSearchSchema,
} from "#/lib/repo-search";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/responses")({
	staticData: { region: "responses" },
	validateSearch: responsesSearchSchema,
	search: { middlewares: [stripSearchParams(RESPONSES_SEARCH_DEFAULTS)] },
	component: ResponsesPage,
	pendingComponent: ResponsesPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} | Responses`),
			description:
				"What Tripwire posts on each change request, and what it hides.",
			noindex: true,
		}),
});
