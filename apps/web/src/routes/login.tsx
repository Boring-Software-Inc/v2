import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "#/components/auth/login-page";
import { LoginPageSkeleton } from "#/components/auth/login-page-skeleton";
import { SIGN_IN_FORGES } from "#/lib/forge-copy";
import { oauthAuthorizeResume } from "#/lib/oauth-resume";
import { buildSeo, formatPageTitle } from "#/lib/seo";
import { type TrackingSearch, trackingSearch } from "#/lib/track";
import { webviewHostQueryOptions } from "#/lib/webview.query";

export const Route = createFileRoute("/login")({
	validateSearch: (
		search: Record<string, unknown>,
	): { redirect?: string } & TrackingSearch => {
		const resume = oauthAuthorizeResume(search);
		return {
			...trackingSearch(search),
			// Same-site paths only — never an open redirect.
			...(resume
				? { redirect: resume }
				: typeof search.redirect === "string" &&
						search.redirect.startsWith("/") &&
						!search.redirect.startsWith("//")
					? { redirect: search.redirect }
					: {}),
		};
	},
	// SSR the in-app-browser detection so the escape card is in the first paint.
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(webviewHostQueryOptions()),
	component: LoginPage,
	pendingComponent: LoginPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Sign in"),
			description: `Sign in to Tripwire with ${SIGN_IN_FORGES}.`,
			noindex: true,
		}),
});
