import { createFileRoute } from "@tanstack/react-router";
import { LoginPage, LoginPageSkeleton } from "#/components/auth/login-page";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
		// Same-site paths only — never an open redirect.
		typeof search.redirect === "string" &&
		search.redirect.startsWith("/") &&
		!search.redirect.startsWith("//")
			? { redirect: search.redirect }
			: {},
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
