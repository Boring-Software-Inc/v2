import { createFileRoute } from "@tanstack/react-router";
import { SettingsSectionSkeleton } from "#/components/settings/settings-layout-skeleton";
import { BillingSettingsPage } from "#/components/settings/settings-pages";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/settings/billing")({
	component: BillingSettingsPage,
	pendingComponent: SettingsSectionSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.org} | Billing`),
			description: "Billing for this org.",
			noindex: true,
		}),
});
