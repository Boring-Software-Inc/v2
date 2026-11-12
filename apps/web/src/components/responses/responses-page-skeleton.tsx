import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

export function BuilderSkeleton() {
	return (
		<div aria-hidden data-layout-role="responses-skeleton-builder">
			<Skeleton className="h-96 rounded-shell max-lg:hidden" />
			<Skeleton className="h-96 rounded-shell" />
			<div className="max-xl:hidden" data-layout-role="page-skeleton-section">
				<SkeletonText className="w-24" type="heading-sm" />
				<Skeleton className="h-72 rounded-shell" />
			</div>
		</div>
	);
}

export function ResponsesPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="flex h-full min-h-0 flex-col overflow-hidden">
				<header data-layout-role="responses-skeleton-header">
					<SkeletonText className="w-40" type="heading" />
				</header>
				<div data-layout-role="responses-skeleton-filter">
					<Skeleton className="h-(--control) w-full rounded-pill lg:w-120" />
				</div>
				<BuilderSkeleton />
			</div>
		</DashboardLayout>
	);
}
