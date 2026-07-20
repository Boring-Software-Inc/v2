import { createFileRoute, redirect } from "@tanstack/react-router";
import { NoOrgsPage } from "#/components/organizations/no-orgs-page";
import { NoOrgsPageSkeleton } from "#/components/organizations/no-orgs-page-skeleton";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { buildSeo, formatPageTitle } from "#/lib/seo";

/**
 * `/` → the last-visited (or personal) org's home. `defaultOrgSlug` is only
 * this redirect's hint — the URL stays the source of truth (§8). Signed-out
 * users were already bounced by __root; open-dev with no orgs renders the
 * create-first-org screen.
 */
export const Route = createFileRoute("/")({
	beforeLoad: async ({ context }) => {
		const session = await context.queryClient.ensureQueryData(
			sessionInfoQueryOptions(),
		);
		if (session.defaultOrgSlug) {
			throw redirect({
				to: "/$org/home",
				params: { org: session.defaultOrgSlug },
			});
		}
	},
	component: NoOrgsPage,
	pendingComponent: NoOrgsPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Home"),
			description: "the contribution gatekeeper.",
			noindex: true,
		}),
});
