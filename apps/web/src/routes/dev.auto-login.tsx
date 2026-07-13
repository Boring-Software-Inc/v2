import { createFileRoute } from "@tanstack/react-router";
import { DevAutoLoginPage } from "#/components/dev/auto-login-page";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/dev/auto-login")({
	validateSearch: (search: Record<string, unknown>): { to?: string } => ({
		to: typeof search.to === "string" ? search.to : undefined,
	}),
	component: DevAutoLoginPage,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Dev sign-in"),
			description: "dev persona auto-login.",
			noindex: true,
		}),
});
