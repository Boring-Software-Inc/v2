import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";

export const PAGE_FRAME = "flex h-[calc(100dvh-8rem)] w-full flex-col";

const SIDEBAR_SLOTS = [
	{ key: "a", name: "w-24" },
	{ key: "b", name: "w-32" },
	{ key: "c", name: "w-28" },
	{ key: "d", name: "w-36" },
] as const;

const CANVAS_SLOTS = [
	{ key: "a", position: "top-16 left-80", name: "w-28" },
	{ key: "b", position: "top-52 left-[34rem]", name: "w-24" },
	{ key: "c", position: "top-[22rem] left-[47rem]", name: "w-32" },
] as const;

function NodeCardSkeleton({ name }: { name: string }) {
	return (
		<div className="min-w-44 max-w-64 rounded-md border bg-card px-3 py-2 shadow-sm">
			<Skeleton className={`h-3 ${name}`} />
			<Skeleton className="mt-1 h-3 w-20" />
			{/* Inline field rows — the value-accepting node body. */}
			<div className="mt-1.5 flex flex-col gap-1 border-border/70 border-t pt-1.5">
				<div className="flex justify-between gap-2">
					<Skeleton className="h-2.5 w-16" />
					<Skeleton className="h-2.5 w-8" />
				</div>
				<div className="flex justify-between gap-2">
					<Skeleton className="h-2.5 w-12" />
					<Skeleton className="h-2.5 w-10" />
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
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
				<Skeleton className="h-3 w-20" />
				<Skeleton className="h-4 w-40" />
				<Skeleton className="h-5 w-12 rounded-full" />
				<div className="ml-auto flex shrink-0 items-center gap-2">
					<Skeleton className="h-6 w-16" />
					<Skeleton className="h-6 w-16" />
				</div>
			</header>
			<div className="relative min-h-0 flex-1">
				<div className="absolute top-3 bottom-3 left-3 z-10 flex w-64 flex-col overflow-hidden rounded-xl border bg-surface-0/95 shadow-md backdrop-blur">
					<div className="flex shrink-0 gap-1 border-b p-1.5">
						<Skeleton className="h-6 flex-1" />
						<Skeleton className="h-6 flex-1" />
					</div>
					<div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-2">
						{SIDEBAR_SLOTS.map((slot) => (
							<NodeCardSkeleton key={slot.key} name={slot.name} />
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
