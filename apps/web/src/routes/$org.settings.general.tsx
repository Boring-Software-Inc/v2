import { createFileRoute } from "@tanstack/react-router";
import { SettingsSectionSkeleton } from "#/components/settings/settings-layout-skeleton";
import { GeneralSettingsPage } from "#/components/settings/settings-pages";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/settings/general")({
	staticData: { region: "settings" },
	component: GeneralSettingsPage,
	pendingComponent: SettingsSectionSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.org} | General`),
			description: "Name, slug and timezone for this org.",
			noindex: true,
		}),
});
