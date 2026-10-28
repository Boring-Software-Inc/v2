import { createFileRoute } from "@tanstack/react-router";
import { SettingsSectionSkeleton } from "#/components/settings/settings-layout-skeleton";
import { ConnectionsSettingsPage } from "#/components/settings/settings-pages";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/settings/connections")({
	component: ConnectionsSettingsPage,
	pendingComponent: SettingsSectionSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.org} | Connections`),
			description: "The forges linked to your account.",
			noindex: true,
		}),
});
