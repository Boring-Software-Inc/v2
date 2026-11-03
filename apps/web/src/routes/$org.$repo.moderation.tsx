import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MODERATION_COLLECTION } from "#/components/moderation/moderation-collection";
import { ModerationPage } from "#/components/moderation/moderation-page";
import { ModerationPageSkeleton } from "#/components/moderation/moderation-page-skeleton";
import { MODERATION_VARIANTS } from "#/components/moderation/moderation-variant-picker";
import { collectionSearchSchema } from "#/lib/collection";
import { buildSeo, formatPageTitle } from "#/lib/seo";

const moderationSearchSchema = z.intersection(
	collectionSearchSchema(MODERATION_COLLECTION),
	z.object({
		__variant: z.enum(MODERATION_VARIANTS).optional().catch(undefined),
	}),
);

export const Route = createFileRoute("/$org/$repo/moderation")({
	staticData: { region: "moderation" },
	validateSearch: moderationSearchSchema,
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
