import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function BuilderSkeleton() {
	return (
		<div aria-hidden data-layout-role="responses-skeleton-builder">
			<span
				data-skeleton-box=""
				aria-hidden
				className="h-96 rounded-shell max-lg:hidden"
			>
				<Skeleton fill />
			</span>
			<span data-skeleton-box="" aria-hidden className="h-96 rounded-shell">
				<Skeleton fill />
			</span>
			<div className="max-xl:hidden" data-layout-role="page-skeleton-section">
				<span data-skeleton-line="" aria-hidden className="w-24">
					<SkeletonText type="heading-sm" />
				</span>
				<span data-skeleton-box="" aria-hidden className="h-72 rounded-shell">
					<Skeleton fill />
				</span>
			</div>
		</div>
	);
}

export function ResponsesPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="flex h-full min-h-0 flex-col overflow-hidden">
				<header data-layout-role="responses-skeleton-header">
					<span data-skeleton-line="" aria-hidden className="w-40">
						<SkeletonText type="heading" />
					</span>
				</header>
				<div data-layout-role="responses-skeleton-filter">
					<span
						data-skeleton-box=""
						aria-hidden
						className="h-(--control) w-full rounded-pill lg:w-120"
					>
						<Skeleton fill />
					</span>
				</div>
				<BuilderSkeleton />
			</div>
		</DashboardLayout>
	);
}
