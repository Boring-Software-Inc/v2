import { createFileRoute } from "@tanstack/react-router";
import { SettingsSectionSkeleton } from "#/components/settings/settings-layout-skeleton";
import { AccountSettingsPage } from "#/components/settings/settings-pages";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/settings/account")({
	component: AccountSettingsPage,
	pendingComponent: SettingsSectionSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Your account"),
			description: "Your profile, sign-in and theme.",
			noindex: true,
		}),
});
