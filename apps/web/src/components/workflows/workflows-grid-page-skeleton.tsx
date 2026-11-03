import { EntityCardSkeleton } from "#/components/common/entity-card-skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

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
			<Page purpose="task">
				<header data-layout-role="page-header">
					<div>
						<SkeletonText className="w-32" type="heading" />
						<SkeletonText className="w-80 max-w-full" type="body" />
					</div>
					<div>
						<Skeleton className="h-(--control-sm) w-36 shrink-0 rounded-pill" />
					</div>
				</header>
				<PageBody>
					<GridSkeleton />
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
