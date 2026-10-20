import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function EconomicsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div
					aria-hidden
					className="mx-auto flex w-full max-w-3xl flex-col gap-8"
				>
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-32" type="heading" />
						<SkeletonText className="max-w-measure" lines={2} type="body" />
					</header>
					<div className="flex flex-col gap-4">
						<SkeletonText className="w-96 max-w-full" type="heading-sm" />
						<Skeleton className="h-36 w-full rounded-panel" />
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<Skeleton className="h-60 w-full rounded-shell" />
						<Skeleton className="h-60 w-full rounded-shell" />
					</div>
					<Skeleton className="h-48 w-full rounded-shell" />
					<Skeleton className="h-48 w-full rounded-shell" />
				</div>
			</div>
		</DashboardLayout>
	);
}
