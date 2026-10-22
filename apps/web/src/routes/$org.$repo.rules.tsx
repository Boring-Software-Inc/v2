import { createFileRoute } from "@tanstack/react-router";
import { RULES_COLLECTION } from "#/components/rules/rules-collection";
import { RulesPage } from "#/components/rules/rules-page";
import { RulesPageSkeleton } from "#/components/rules/rules-page-skeleton";
import { collectionSearchSchema } from "#/lib/collection";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/rules")({
	validateSearch: collectionSearchSchema(RULES_COLLECTION),
	component: RulesPage,
	pendingComponent: RulesPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} | Rules`),
			description: "The rules this repo checks.",
			noindex: true,
		}),
});
