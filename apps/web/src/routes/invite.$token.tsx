import { createFileRoute } from "@tanstack/react-router";
import { InvitePage } from "#/components/organizations/invite-page";
import { InvitePageSkeleton } from "#/components/organizations/invite-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/invite/$token")({
	component: InvitePage,
	pendingComponent: InvitePageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Join an org"),
			description: "redeem a tripwire invite link.",
			noindex: true,
		}),
});
