import { createFileRoute } from "@tanstack/react-router";
import { parseRulesSearch } from "#/components/rules/rules-collection";
import { RulesPage } from "#/components/rules/rules-page";
import { RulesPageSkeleton } from "#/components/rules/rules-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/rules")({
	staticData: { region: "rules" },
	validateSearch: parseRulesSearch,
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
