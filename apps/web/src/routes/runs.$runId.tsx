import { createFileRoute } from "@tanstack/react-router";
import { RunPage } from "#/components/runs/run-page";
import { RunPageSkeleton } from "#/components/runs/run-page-skeleton";
import { runRouteScope } from "#/lib/active-scope";
import { runQueryOptions } from "#/lib/runs.query";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/runs/$runId")({
	loader: async ({ context, params }) => {
		const run = await context.queryClient
			.ensureQueryData(runQueryOptions(params.runId))
			.catch(() => null);
		return { scope: runRouteScope(run) };
	},
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
