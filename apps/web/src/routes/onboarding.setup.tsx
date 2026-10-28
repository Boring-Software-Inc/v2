import { createFileRoute } from "@tanstack/react-router";
import { setupSearchSchema } from "@tripwire/contracts";
import { InstallSetupPage } from "#/components/organizations/install-setup-page";
import { InstallSetupPageSkeleton } from "#/components/organizations/install-setup-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/onboarding/setup")({
	validateSearch: (search) => setupSearchSchema.parse(search),
	component: InstallSetupPage,
	pendingComponent: InstallSetupPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Connect installation"),
			description: "Choose the Tripwire org that checks this installation.",
			noindex: true,
		}),
});
