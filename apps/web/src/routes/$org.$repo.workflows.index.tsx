import { createFileRoute } from "@tanstack/react-router";
import {
	WorkflowsGridPage,
	WorkflowsGridPageSkeleton,
} from "#/components/workflows/workflows-grid-page";
import { buildSeo, formatPageTitle } from "#/lib/seo";

/** The workflows GRID (§grid). Index route on purpose — a flat workflows.tsx
 * would become a layout whose redirects hijack the editor child. */
export const Route = createFileRoute("/$org/$repo/workflows/")({
	component: WorkflowsGridPage,
	pendingComponent: WorkflowsGridPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} · workflows`),
			description: "workflows this repo runs.",
			noindex: true,
		}),
});
