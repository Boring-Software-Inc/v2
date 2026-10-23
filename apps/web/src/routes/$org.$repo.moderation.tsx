import { createFileRoute } from "@tanstack/react-router";
import { MODERATION_COLLECTION } from "#/components/moderation/moderation-collection";
import { ModerationPage } from "#/components/moderation/moderation-page";
import { ModerationPageSkeleton } from "#/components/moderation/moderation-page-skeleton";
import { collectionSearchSchema } from "#/lib/collection";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/moderation")({
	staticData: { region: "moderation" },
	validateSearch: collectionSearchSchema(MODERATION_COLLECTION),
	component: ModerationPage,
	pendingComponent: ModerationPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} | Human review`),
			description: "Change requests and comments waiting for human review.",
			noindex: true,
		}),
});
