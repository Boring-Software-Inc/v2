import { createFileRoute } from "@tanstack/react-router";
import { SettingsSectionSkeleton } from "#/components/settings/settings-layout-skeleton";
import { AgentsSettingsPage } from "#/components/settings/settings-pages";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/settings/agents")({
	component: AgentsSettingsPage,
	pendingComponent: SettingsSectionSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.org} | Agents`),
			description: "Agents connected to your account.",
			noindex: true,
		}),
});
