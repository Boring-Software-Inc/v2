import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "#/components/auth/login-page";
import { LoginPageSkeleton } from "#/components/auth/login-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";
import { webviewHostQueryOptions } from "#/lib/webview.query";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
		// Same-site paths only — never an open redirect.
		typeof search.redirect === "string" &&
		search.redirect.startsWith("/") &&
		!search.redirect.startsWith("//")
			? { redirect: search.redirect }
			: {},
	// SSR the in-app-browser detection so the escape card is in the first paint.
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(webviewHostQueryOptions()),
	component: LoginPage,
	pendingComponent: LoginPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Sign in"),
			description: "maintainer sign-in via github.",
			noindex: true,
		}),
});
