import { createFileRoute } from "@tanstack/react-router";
import { SettingsLayout } from "#/components/settings/settings-layout";
import { SettingsLayoutSkeleton } from "#/components/settings/settings-layout-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/settings")({
	component: SettingsLayout,
	pendingComponent: SettingsLayoutSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.org} | Settings`),
			description: "Members, roles and settings for this org.",
			noindex: true,
		}),
});
