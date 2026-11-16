import { createFileRoute } from "@tanstack/react-router";
import { oauthWaitlistSearchSchema } from "@tripwire/contracts";
import { WaitlistEntryPage } from "#/components/auth/waitlist-entry-page";
import { buildSeo, formatPageTitle } from "#/lib/seo";
import { trackingSearch } from "#/lib/track";

/**
 * Popup entry point for the cross-deployment "Join waitlist with GitHub" flow.
 * The landing site opens this in a popup; it starts GitHub sign-in and points
 * the OAuth callback at the closer, threading the opener origin through so the
 * closer knows which window to notify.
 */
export const Route = createFileRoute("/oauth/waitlist")({
	component: WaitlistEntryPage,
	validateSearch: (
		search: Parameters<typeof oauthWaitlistSearchSchema.parse>[0],
	) => {
		const parsed = oauthWaitlistSearchSchema.parse(search);
		return {
			opener: parsed.opener,
			mode: parsed.mode,
			...trackingSearch(search),
		};
	},
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Join the waitlist"),
			description: "Request Tripwire access with GitHub.",
			noindex: true,
		}),
});
