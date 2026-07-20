import { DashboardLayout } from "#/components/layouts/dashboard-layout";

// full-bleed under the topbar: viewport minus the shell's chrome.
export const PAGE_FRAME = "flex h-[calc(100dvh-8rem)] w-full flex-col";

export function WorkflowEditorPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className={PAGE_FRAME}>
				<EditorFrameSkeleton />
			</div>
		</DashboardLayout>
	);
}

export function EditorFrameSkeleton() {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
				<div className="h-4 w-20 animate-pulse rounded-md bg-surface-1" />
				<div className="h-5 w-40 animate-pulse rounded-md bg-surface-1" />
				<div className="ml-auto h-6 w-24 animate-pulse rounded-md bg-surface-1" />
			</div>
			<div className="relative min-h-0 flex-1">
				<div className="absolute top-3 bottom-3 left-3 w-60 animate-pulse rounded-lg bg-surface-1" />
			</div>
		</div>
	);
}
