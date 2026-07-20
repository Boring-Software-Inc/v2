import { createFileRoute } from "@tanstack/react-router";
import { WorkflowEditorPage } from "#/components/workflows/editor/workflow-editor-page";
import { WorkflowEditorPageSkeleton } from "#/components/workflows/editor/workflow-editor-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

/** The full-screen editor (§editor rebuild). */
export const Route = createFileRoute("/$org/$repo/workflows/$workflowId")({
	component: WorkflowEditorPage,
	pendingComponent: WorkflowEditorPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} · workflow editor`),
			description: "edit this workflow's graph.",
			noindex: true,
		}),
});
