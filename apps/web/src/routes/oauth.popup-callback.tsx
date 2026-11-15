import { createFileRoute } from "@tanstack/react-router";
import { oauthPopupSearchSchema } from "@tripwire/contracts";
import { PopupCallbackPage } from "#/components/auth/popup-callback-page";
import { buildSeo, formatPageTitle } from "#/lib/seo";
import { trackingSearch } from "#/lib/track";

export const Route = createFileRoute("/oauth/popup-callback")({
	component: PopupCallbackPage,
	validateSearch: (
		search: Parameters<typeof oauthPopupSearchSchema.parse>[0],
	) => {
		const parsed = oauthPopupSearchSchema.parse(search);
		return {
			opener: parsed.opener,
			error: parsed.error,
			mode: parsed.mode,
			...trackingSearch(search),
		};
	},
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Finishing sign-in"),
			description: "Completing your Tripwire waitlist request.",
			noindex: true,
		}),
});
