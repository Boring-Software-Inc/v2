import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function BuilderSkeleton() {
	return (
		<div
			aria-hidden
			className="grid flex-1 grid-cols-1 gap-4 px-4 pb-6 md:px-6 lg:grid-cols-[--spacing(66)_minmax(0,1fr)] lg:px-8 xl:grid-cols-[--spacing(66)_minmax(0,1fr)_--spacing(96)]"
		>
			<Skeleton className="h-96 rounded-shell max-lg:hidden" />
			<Skeleton className="h-96 rounded-shell" />
			<div className="flex flex-col gap-3 max-xl:hidden">
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
				<header className="flex items-center px-4 pt-4 pb-3 md:px-6 lg:min-h-18 lg:px-8 lg:py-3">
					<SkeletonText className="w-40" type="heading" />
				</header>
				<div className="px-4 pb-4 md:px-6 lg:px-8">
					<Skeleton className="h-(--control) w-full rounded-pill lg:w-120" />
				</div>
				<BuilderSkeleton />
			</div>
		</DashboardLayout>
	);
}
