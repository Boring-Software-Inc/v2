import { createFileRoute } from "@tanstack/react-router";
import { RuleSettingsPage } from "#/components/rules/rule-settings-page";
import { RuleSettingsPageSkeleton } from "#/components/rules/rule-settings-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/rules_/$ruleId/settings")({
	staticData: { region: "rules" },
	component: RuleSettingsPage,
	pendingComponent: RuleSettingsPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Rule settings"),
			description: "Manage settings for a repository rule.",
			noindex: true,
		}),
});
