import { EntityCardSkeleton } from "#/components/common/entity-card-skeleton";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const ROW_SLOTS = ["a", "b", "c", "d"] as const;

export function GridSkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-3">
			{ROW_SLOTS.map((slot) => (
				<EntityCardSkeleton key={slot} />
			))}
		</div>
	);
}

export function WorkflowsGridPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-wrap items-start justify-between gap-4">
						<div className="flex flex-col gap-1">
							<SkeletonText className="w-32" type="heading" />
							<SkeletonText className="w-80 max-w-full" type="body" />
						</div>
						<Skeleton className="h-(--control-sm) w-36 shrink-0 rounded-pill" />
					</header>
					<GridSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
