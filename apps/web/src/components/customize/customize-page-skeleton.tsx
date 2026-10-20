import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const OPTION_SLOTS = ["a", "b", "c", "d"] as const;

export function CustomizeBodySkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-6">
			<div className="flex gap-2">
				<Skeleton className="h-(--control) w-20 rounded-pill" />
				<Skeleton className="h-(--control) w-20 rounded-pill" />
				<Skeleton className="h-(--control) w-28 rounded-pill" />
			</div>
			<div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5 lg:gap-8">
				<div className="flex flex-col gap-3 lg:col-span-2">
					<SkeletonText className="w-24" type="heading-sm" />
					<SkeletonText className="w-56" type="body-sm" />
					{OPTION_SLOTS.map((slot) => (
						<div className="flex items-start gap-3" key={slot}>
							<Skeleton className="size-4 rounded-pill" />
							<div className="flex flex-1 flex-col gap-1">
								<SkeletonText className="w-28" type="label" />
								<SkeletonText className="w-48" type="body-sm" />
							</div>
						</div>
					))}
				</div>
				<div className="flex flex-col gap-4 rounded-shell bg-shell p-3 md:p-4 lg:col-span-3">
					<SkeletonText className="w-16" type="label-sm" />
					<Skeleton className="h-60 w-full rounded-panel" />
					<SkeletonText className="w-16" type="label-sm" />
					<Skeleton className="h-(--row) w-full rounded-panel" />
				</div>
			</div>
		</div>
	);
}

export function CustomizePageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-8">
				<div className="flex w-full flex-col gap-6">
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-40" type="heading" />
						<SkeletonText className="w-80" type="body" />
					</header>
					<CustomizeBodySkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
