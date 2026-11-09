import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

const SIDEBAR_SLOTS = [
	{ key: "trigger", size: "narrow" },
	{ key: "rules", size: "wide" },
	{ key: "gates", size: "medium" },
	{ key: "actions", size: "wider" },
	{ key: "delivery", size: "narrow" },
] as const;
const CANVAS_SLOTS = [
	{ key: "a", position: "start", nameSize: "medium" },
	{ key: "b", position: "middle", nameSize: "narrow" },
	{ key: "c", position: "end", nameSize: "wide" },
] as const;

function SkeletonBlock({
	layoutRole,
	size,
}: {
	layoutRole?: string;
	size?: string;
}) {
	return (
		<div data-layout-role={layoutRole} data-layout-size={size}>
			<Skeleton />
		</div>
	);
}

function NodeCardSkeleton({ nameSize }: { nameSize: string }) {
	return (
		<div data-layout-role="workflow-editor-skeleton-node">
			<SkeletonText
				data-layout-role="workflow-editor-skeleton-node-name"
				data-layout-size={nameSize}
				type="label"
			/>
			<SkeletonText
				data-layout-role="workflow-editor-skeleton-node-code"
				type="code-sm"
			/>
			<div data-layout-role="workflow-editor-skeleton-node-meta">
				<div>
					<SkeletonText data-layout-size="medium" type="caption" />
					<SkeletonText data-layout-size="short" type="caption" />
				</div>
				<div>
					<SkeletonText data-layout-size="narrow" type="caption" />
					<SkeletonText data-layout-size="small" type="caption" />
				</div>
			</div>
		</div>
	);
}

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
				<SkeletonBlock layoutRole="workflow-editor-skeleton-back" />
				<SkeletonBlock layoutRole="workflow-editor-skeleton-name" />
				<div data-layout-role="workflow-editor-skeleton-actions">
					<SkeletonBlock size="wide" />
					<SkeletonBlock size="medium" />
					<SkeletonBlock size="narrow" />
				</div>
			</header>
			<div data-layout-role="workflow-editor-skeleton-workspace">
				<div data-layout-role="workflow-editor-skeleton-sidebar">
					<div data-layout-role="workflow-editor-skeleton-tabs">
						<SkeletonBlock />
						<SkeletonBlock />
					</div>
					<div data-layout-role="workflow-editor-skeleton-palette">
						{SIDEBAR_SLOTS.map((slot) => (
							<div key={slot.key}>
								<SkeletonText data-layout-size={slot.size} type="label" />
								<SkeletonText lines={2} type="body-sm" />
							</div>
						))}
					</div>
				</div>
				{CANVAS_SLOTS.map((slot) => (
					<div
						data-layout-position={slot.position}
						data-layout-role="workflow-editor-skeleton-canvas-node"
						key={slot.key}
					>
						<NodeCardSkeleton nameSize={slot.nameSize} />
					</div>
				))}
			</div>
		</div>
	);
}
