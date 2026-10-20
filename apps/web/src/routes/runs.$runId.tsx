import { createFileRoute } from "@tanstack/react-router";
import { RunPage } from "#/components/runs/run-page";
import { RunPageSkeleton } from "#/components/runs/run-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/runs/$runId")({
	component: RunPage,
	pendingComponent: RunPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`Run ${params.runId.slice(0, 8)}`),
			description: "Every rule, step, and piece of evidence for this run.",
			noindex: true,
		}),
});
