import { createFileRoute } from "@tanstack/react-router";
import { signInForgeLabels } from "@tripwire/utils/forge-sign-in";
import { LoginPage } from "#/components/auth/login-page";
import { LoginPageSkeleton } from "#/components/auth/login-page-skeleton";
import { signInProviderIdsQueryOptions } from "#/lib/auth.query";
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
	/** Keep provider availability and browser detection in the SSR query cache. */
	loader: async ({ context }) => {
		const [signInProviderIds] = await Promise.all([
			context.queryClient.ensureQueryData(signInProviderIdsQueryOptions()),
			context.queryClient.ensureQueryData(webviewHostQueryOptions()),
		]);
		return { signInProviderIds };
	},
	component: LoginPage,
	pendingComponent: LoginPageSkeleton,
	head: ({ match, loaderData }) => {
		const forges = signInForgeLabels(loaderData?.signInProviderIds ?? []);
		return buildSeo({
			path: match.pathname,
			title: formatPageTitle("Sign in"),
			description: forges
				? `Sign in to Tripwire with ${forges}.`
				: "Sign in to Tripwire.",
			noindex: true,
		});
	},
});
