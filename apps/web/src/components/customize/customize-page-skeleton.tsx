import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export const PAGE_FRAME =
	"flex h-[calc(100dvh-8rem)] w-full flex-col gap-4 px-6 py-6";

export const SPLIT_FRAME = "flex min-h-0 flex-1 flex-col gap-3 md:flex-row";

function HeaderSkeleton() {
	return (
		<header className="flex shrink-0 flex-col gap-1">
			<SkeletonText className="w-32" type="heading" />
			<SkeletonText className="w-72 max-w-full" type="body" />
		</header>
	);
}

function PanelHeaderSkeleton() {
	return (
		<div className="flex shrink-0 flex-col border-line-faint border-b p-3">
			<SkeletonText className="w-24" type="label" />
			<SkeletonText className="w-48" type="body-sm" />
		</div>
	);
}

function PreviewBodySkeleton() {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 p-3">
			<Skeleton className="h-(--control-sm) w-56 rounded-pill" />
			<Skeleton className="min-h-0 w-full flex-1 rounded-panel" />
			<Skeleton className="h-(--control-lg) w-full shrink-0 rounded-panel" />
		</div>
	);
}

function FormBodySkeleton() {
	return (
		<div className="flex flex-col gap-3 p-3">
			<SkeletonText className="w-20" type="label" />
			<Skeleton className="h-(--control-sm) w-full rounded-pill" />
			<SkeletonText className="mt-3 w-20" type="label" />
			<Skeleton className="h-(--control-sm) w-full rounded-pill" />
		</div>
	);
}

export function CustomizePageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div aria-hidden className={`${PAGE_FRAME} hidden md:flex`}>
				<HeaderSkeleton />
				<div className={SPLIT_FRAME}>
					<section className="shell flex min-h-0 flex-col md:w-96 md:shrink-0">
						<div className="panel flex min-h-0 flex-1 flex-col">
							<PanelHeaderSkeleton />
							<FormBodySkeleton />
						</div>
					</section>
					<section className="shell flex min-h-0 flex-1 flex-col">
						<div className="panel flex min-h-0 flex-1 flex-col">
							<PanelHeaderSkeleton />
							<PreviewBodySkeleton />
						</div>
					</section>
				</div>
			</div>
			<div aria-hidden className="flex h-full flex-col md:hidden">
				<div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pt-6 pb-3">
					<HeaderSkeleton />
					<section className="shell flex min-h-0 flex-1 flex-col">
						<div className="panel flex min-h-0 flex-1 flex-col">
							<PanelHeaderSkeleton />
							<PreviewBodySkeleton />
						</div>
					</section>
				</div>
				<div className="shrink-0 border-line-faint border-t px-4 py-2">
					<Skeleton className="h-(--control) w-36 rounded-pill" />
				</div>
			</div>
		</DashboardLayout>
	);
}
