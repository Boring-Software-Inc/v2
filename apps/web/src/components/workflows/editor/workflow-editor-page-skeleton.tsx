import { Icon, Pending } from "@tripwire/ui/icon";
import { SkeletonText } from "@tripwire/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function WorkflowEditorPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div data-layout-role="workflow-editor-frame">
				<EditorFrameSkeleton />
			</div>
		</DashboardLayout>
	);
}

export function EditorFrameSkeleton() {
	return (
		<div aria-hidden data-layout-role="workflow-editor-skeleton">
			<header data-layout-role="workflow-editor-skeleton-header">
				<span data-layout-role="workflow-editor-skeleton-back">Workflows</span>
				<span data-layout-role="workflow-editor-skeleton-name">
					<SkeletonText type="label" />
				</span>
			</header>
			<div data-layout-role="workflow-editor-skeleton-workspace">
				<span data-layout-role="workflow-editor-skeleton-spinner">
					<Icon icon={Pending} motion="spin" />
				</span>
			</div>
		</div>
	);
}
