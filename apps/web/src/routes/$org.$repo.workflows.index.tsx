import { createFileRoute } from "@tanstack/react-router";
import { WORKFLOWS_COLLECTION } from "#/components/workflows/workflows-collection";
import { WorkflowsGridPage } from "#/components/workflows/workflows-grid-page";
import { WorkflowsGridPageSkeleton } from "#/components/workflows/workflows-grid-page-skeleton";
import { collectionSearchSchema } from "#/lib/collection";
import { buildSeo, formatPageTitle } from "#/lib/seo";

/** The workflows GRID (§grid). Index route on purpose — a flat workflows.tsx
 * would become a layout whose redirects hijack the editor child. */
export const Route = createFileRoute("/$org/$repo/workflows/")({
	validateSearch: collectionSearchSchema(WORKFLOWS_COLLECTION),
	component: WorkflowsGridPage,
	pendingComponent: WorkflowsGridPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} | Workflows`),
			description: "The workflows this repo runs.",
			noindex: true,
		}),
});
