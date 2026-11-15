import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { EntityCardSkeleton } from "#/components/common/entity-card-skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";

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
						<span data-skeleton-line="" aria-hidden className="w-32">
							<SkeletonText type="heading" />
						</span>
						<span data-skeleton-line="" aria-hidden className="w-80 max-w-full">
							<SkeletonText type="body" />
						</span>
					</div>
					<div>
						<span
							data-skeleton-box=""
							aria-hidden
							className="h-(--control-sm) w-36 shrink-0 rounded-pill"
						>
							<Skeleton fill />
						</span>
					</div>
				</header>
				<PageBody>
					<GridSkeleton />
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
