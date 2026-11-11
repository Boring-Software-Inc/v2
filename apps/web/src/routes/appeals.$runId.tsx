import { createFileRoute, notFound } from "@tanstack/react-router";
import { contributionAppealRunSchema } from "@tripwire/contracts";
import { AppealPage } from "#/components/appeals/appeal-page";
import { AppealPageSkeleton } from "#/components/appeals/appeal-page-skeleton";
import { contributionAppealOptions } from "#/lib/contribution-appeals.query";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/appeals/$runId")({
	params: {
		parse: (params) => {
			const parsed = contributionAppealRunSchema.safeParse(params);
			if (!parsed.success) throw notFound();
			return parsed.data;
		},
	},
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(
			contributionAppealOptions(params.runId),
		),
	component: AppealPage,
	pendingComponent: AppealPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Appeal a moderation decision"),
			noindex: true,
		}),
});
