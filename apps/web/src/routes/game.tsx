import { createFileRoute, notFound } from "@tanstack/react-router";
import { RunnerPage } from "#/components/mascot/runner/runner-page";
import { RunnerPageSkeleton } from "#/components/mascot/runner/runner-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/game")({
	beforeLoad: () => {
		if (!import.meta.env.DEV) {
			throw notFound();
		}
	},
	component: RunnerPage,
	pendingComponent: RunnerPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Ghost game"),
			description: "Ghost runner preview for the empty states.",
			noindex: true,
		}),
});
