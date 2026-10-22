import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const OPTION_SLOTS = ["a", "b", "c", "d", "e"] as const;

export function SettingsSkeleton() {
	return (
		<div aria-hidden className="flex max-w-140 flex-col gap-2">
			<div className="flex flex-col gap-1 px-3">
				<SkeletonText className="w-24" type="heading-sm" />
				<SkeletonText className="w-56" type="body-sm" />
			</div>
			{OPTION_SLOTS.map((slot, i) => (
				<div
					className={
						i === 0 ? "flex gap-3 px-3 py-2" : "flex gap-3 py-2 ps-10 pe-3"
					}
					key={slot}
				>
					<Skeleton className="size-4 rounded-tag" />
					<div className="flex flex-1 flex-col gap-1">
						<SkeletonText className="w-28" type="label" />
						<SkeletonText className="w-48" type="body-sm" />
					</div>
				</div>
			))}
		</div>
	);
}

export function PreviewSkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-6">
			<div className="flex items-start gap-3">
				<Skeleton className="hidden size-10 shrink-0 rounded-tag sm:block" />
				<Skeleton className="h-60 flex-1 rounded-shell" />
			</div>
			<Skeleton className="h-(--row) rounded-shell sm:ms-13" />
		</div>
	);
}

export function ResponsesPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="relative flex h-full min-h-0 flex-col overflow-hidden lg:grid lg:grid-cols-[--spacing(120)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[--spacing(150)_minmax(0,1fr)] min-[96rem]:grid-cols-[--spacing(160)_minmax(0,1fr)]">
				<header className="flex flex-wrap items-center gap-x-10 gap-y-3 px-4 pt-4 pb-3 md:px-6 lg:col-span-2 lg:min-h-18 lg:px-8 lg:py-3">
					<div className="flex flex-1 flex-col gap-1 lg:flex-none">
						<SkeletonText className="w-40" type="heading" />
						<SkeletonText className="w-80 max-lg:hidden" type="body-sm" />
					</div>
					<Skeleton className="order-last h-(--control) w-full rounded-pill lg:order-none lg:w-72" />
				</header>
				<div className="flex flex-col px-1 md:px-3 lg:col-start-1 lg:row-start-2 lg:px-0">
					<div className="h-12 max-lg:hidden" />
					<div className="lg:p-5">
						<SettingsSkeleton />
					</div>
				</div>
				<div className="absolute inset-x-0 bottom-0 h-15 rounded-t-shell bg-shell lg:static lg:col-start-2 lg:row-start-2 lg:h-auto lg:rounded-none">
					<div className="h-12 max-lg:hidden" />
					<div className="max-w-196 p-8 max-lg:hidden">
						<PreviewSkeleton />
					</div>
				</div>
			</div>
		</DashboardLayout>
	);
}
