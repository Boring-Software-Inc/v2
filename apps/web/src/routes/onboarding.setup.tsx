import { createFileRoute } from "@tanstack/react-router";
import { InstallSetupPage } from "#/components/organizations/install-setup-page";
import { InstallSetupPageSkeleton } from "#/components/organizations/install-setup-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

/**
 * The GitHub App **Setup URL** callback (§10) — the path is an external
 * contract (configured in the App settings), so it keeps its /onboarding/setup
 * address even though user-onboarding is gone. GitHub redirects here with
 * `?installation_id=…&setup_action=…&state=…`. NOTHING is claimed here:
 * a valid state renders the CONFIRMATION naming both sides ("GitHub org X →
 * Tripwire org Y") with a change option; a missing/invalid state renders the
 * CLAIM screen with an org picker. Never auto-attach on a guess.
 */
export const Route = createFileRoute("/onboarding/setup")({
	validateSearch: (search: Record<string, unknown>) => ({
		installation_id:
			typeof search.installation_id === "string"
				? search.installation_id
				: undefined,
		setup_action:
			typeof search.setup_action === "string" ? search.setup_action : undefined,
		state: typeof search.state === "string" ? search.state : undefined,
	}),
	component: InstallSetupPage,
	pendingComponent: InstallSetupPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Connect installation"),
			description: "confirm where this GitHub installation lands.",
			noindex: true,
		}),
});
