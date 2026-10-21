import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export const PAGE_FRAME = "flex h-full w-full flex-col";

const SIDEBAR_SLOTS = [
	{ key: "a", name: "w-24" },
	{ key: "b", name: "w-32" },
	{ key: "c", name: "w-28" },
	{ key: "d", name: "w-36" },
	{ key: "e", name: "w-24" },
] as const;

const CANVAS_SLOTS = [
	{ key: "a", position: "top-16 left-80", name: "w-28" },
	{ key: "b", position: "top-52 left-136", name: "w-24" },
	{ key: "c", position: "top-88 left-188", name: "w-32" },
] as const;

function NodeCardSkeleton({ name }: { name: string }) {
	return (
		<div className="min-w-44 max-w-64 rounded-panel border border-line-faint bg-paper px-3 py-2">
			<SkeletonText className={name} type="label" />
			<SkeletonText className="w-20" type="code-sm" />
			<div className="mt-2 flex flex-col gap-1 border-line-faint border-t pt-2">
				<div className="flex justify-between gap-2">
					<SkeletonText className="w-16" type="caption" />
					<SkeletonText className="w-8" type="caption" />
				</div>
				<div className="flex justify-between gap-2">
					<SkeletonText className="w-12" type="caption" />
					<SkeletonText className="w-10" type="caption" />
				</div>
			</div>
		</div>
	);
}

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
		<div aria-hidden className="flex h-full min-h-0 flex-1 flex-col">
			<header className="flex shrink-0 flex-wrap items-center gap-2 border-line-faint border-b px-3 py-2">
				<Skeleton className="h-(--control-sm) w-24 rounded-pill" />
				<Skeleton className="h-(--control-sm) w-48 rounded-pill" />
				<div className="ms-auto flex shrink-0 items-center gap-2">
					<Skeleton className="h-(--control-sm) w-20 rounded-pill" />
					<Skeleton className="h-(--control-sm) w-16 rounded-pill" />
					<Skeleton className="h-(--control-sm) w-14 rounded-pill" />
				</div>
			</header>
			<div className="relative min-h-0 flex-1 bg-page">
				<div className="shell absolute start-3 top-3 bottom-3 z-(--z-raised) flex w-64 flex-col gap-(--shell-inset)">
					<div className="flex shrink-0 gap-2 px-1 pt-1">
						<Skeleton className="h-(--control-sm) w-20 rounded-pill" />
						<Skeleton className="h-(--control-sm) w-20 rounded-pill" />
					</div>
					<div className="panel flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
						{SIDEBAR_SLOTS.map((slot) => (
							<div className="flex flex-col gap-1" key={slot.key}>
								<SkeletonText className={slot.name} type="label" />
								<SkeletonText lines={2} type="body-sm" />
							</div>
						))}
					</div>
				</div>
				{CANVAS_SLOTS.map((slot) => (
					<div
						className={`absolute hidden md:block ${slot.position}`}
						key={slot.key}
					>
						<NodeCardSkeleton name={slot.name} />
					</div>
				))}
			</div>
		</div>
	);
}
