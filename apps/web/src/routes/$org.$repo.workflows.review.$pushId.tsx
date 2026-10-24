import { createFileRoute } from "@tanstack/react-router";
import { WorkflowPushReviewPage } from "#/components/workflows/review/workflow-push-review-page";
import { WorkflowPushReviewPageSkeleton } from "#/components/workflows/review/workflow-push-review-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/$org/$repo/workflows/review/$pushId")({
	staticData: { region: "workflows" },
	component: WorkflowPushReviewPage,
	pendingComponent: WorkflowPushReviewPageSkeleton,
	head: ({ params, match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle(`${params.repo} | Review push`),
			description: "Review workflows pushed from the CLI.",
			noindex: true,
		}),
});
