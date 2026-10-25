import { createFileRoute } from "@tanstack/react-router";
import { SettingsSectionSkeleton } from "#/components/settings/settings-layout-skeleton";
import { RolesSettingsPage } from "#/components/settings/settings-pages";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/settings/roles")({
	staticData: { region: "members" },
	component: RolesSettingsPage,
	pendingComponent: SettingsSectionSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.org} | Roles`),
			description: "Custom roles for this org.",
			noindex: true,
		}),
});
