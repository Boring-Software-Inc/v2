import { createFileRoute } from "@tanstack/react-router";
import { RulesReplayPage } from "#/components/rules/rules-replay-page";
import { RulesReplayPageSkeleton } from "#/components/rules/rules-replay-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/moderation_/replay")({
	staticData: { region: "rules" },
	component: RulesReplayPage,
	pendingComponent: RulesReplayPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${match.context.repo.name} | Rule replay`),
			description: "What your rules would have done on recent change requests.",
			noindex: true,
		}),
});
