import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { WorkflowEditorPage } from "#/components/workflows/editor/workflow-editor-page";
import { WorkflowEditorPageSkeleton } from "#/components/workflows/editor/workflow-editor-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";
import {
	WORKFLOW_EDITOR_SEARCH_DEFAULTS,
	workflowEditorSearchSchema,
} from "#/lib/workflow-editor-search";

/** The full-screen editor (§editor rebuild). */
export const Route = createFileRoute("/$org/$repo/workflows/$workflowId")({
	staticData: { region: "workflows" },
	validateSearch: workflowEditorSearchSchema,
	search: { middlewares: [stripSearchParams(WORKFLOW_EDITOR_SEARCH_DEFAULTS)] },
	component: WorkflowEditorPage,
	pendingComponent: WorkflowEditorPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} | Workflow editor`),
			description: "Edit this workflow.",
			noindex: true,
		}),
});
