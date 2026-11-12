import { createFileRoute, notFound } from "@tanstack/react-router";
import {
	contributionAppealOrgSchema,
	contributionAppealRunSchema,
} from "@tripwire/contracts";
import { AppealPageSkeleton } from "#/components/appeals/appeal-page-skeleton";
import { AppealsPage } from "#/components/appeals/appeals-page";
import {
	contributionAppealOptions,
	contributionAppealPortalOptions,
} from "#/lib/contribution-appeals.query";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/appeals/$target")({
	validateSearch: (search): { preview?: "public" } =>
		search.preview === "public" ? { preview: "public" } : {},
	loader: async ({ context, params: { target } }) => {
		const run = contributionAppealRunSchema.safeParse({ runId: target });
		if (run.success) {
			await context.queryClient.ensureQueryData(
				contributionAppealOptions(run.data.runId),
			);
			return { kind: "case", runId: run.data.runId } as const;
		}
		const portal = contributionAppealOrgSchema.safeParse({ org: target });
		if (!portal.success) throw notFound();
		await context.queryClient.ensureQueryData(
			contributionAppealPortalOptions(portal.data.org),
		);
		return { kind: "portal", org: portal.data.org } as const;
	},
	component: AppealsPage,
	pendingComponent: AppealPageSkeleton,
	head: ({ match, loaderData }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(
				loaderData?.kind === "case"
					? "Appeal a moderation decision"
					: "Contribution appeals",
			),
			noindex: true,
		}),
});
