import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { ResponsesPage } from "#/components/responses/responses-page";
import { ResponsesPageSkeleton } from "#/components/responses/responses-page-skeleton";
import {
	RESPONSES_SEARCH_DEFAULTS,
	responsesSearchSchema,
} from "#/lib/repo-search";
import { buildSeo, formatPageTitle } from "#/lib/seo";
import { completeResponsesStep } from "#/lib/setup-page-view";

const PAGE_COPY = {
	title: "Responses",
	description: "Choose what Tripwire does after each workflow outcome.",
	seoDescription:
		"What Tripwire posts on each change request, and what it hides.",
} as const;

function ResponsesRoutePage() {
	return (
		<ResponsesPage
			description={PAGE_COPY.description}
			title={PAGE_COPY.title}
		/>
	);
}

export const Route = createFileRoute("/$org/$repo/responses")({
	staticData: { region: "responses" },
	validateSearch: responsesSearchSchema,
	search: { middlewares: [stripSearchParams(RESPONSES_SEARCH_DEFAULTS)] },
	loader: ({ params, context, preload }) => {
		if (!preload) {
			void completeResponsesStep(context.queryClient, params.org, params.repo);
		}
	},
	component: ResponsesRoutePage,
	pendingComponent: ResponsesPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} | Responses`),
			description: PAGE_COPY.seoDescription,
			noindex: true,
		}),
});
