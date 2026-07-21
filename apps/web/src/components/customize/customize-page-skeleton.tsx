import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";

export const PAGE_FRAME =
	"flex h-[calc(100dvh-8rem)] w-full flex-col gap-4 px-6 py-6";

export const SPLIT_FRAME = "flex min-h-0 flex-1 flex-col gap-3 md:flex-row";

function HeaderSkeleton() {
	return (
		<header className="flex shrink-0 flex-col gap-1.5">
			<Skeleton className="h-7 w-32" />
			<Skeleton className="h-4 w-72" />
		</header>
	);
}

function PanelHeaderSkeleton() {
	return (
		<div className="flex shrink-0 flex-col gap-1.5 bg-surface-1 px-3.5 py-3">
			<Skeleton className="h-4 w-24" />
			<Skeleton className="h-3 w-48" />
		</div>
	);
}

function PreviewBodySkeleton() {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
			<div className="flex gap-1.5">
				<Skeleton className="h-6 w-[72px] rounded-full" />
				<Skeleton className="h-6 w-[72px] rounded-full" />
				<Skeleton className="h-6 w-[72px] rounded-full" />
			</div>
			<Skeleton className="min-h-0 w-full flex-1 rounded-xl" />
			<Skeleton className="h-9 w-full shrink-0 rounded-xl" />
		</div>
	);
}

export function CustomizePageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			{/* Desktop: the two-panel frame. */}
			<div className={`${PAGE_FRAME} hidden md:flex`}>
				<HeaderSkeleton />
				<div className={SPLIT_FRAME}>
					<section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card md:w-96 md:shrink-0">
						<PanelHeaderSkeleton />
						<div className="flex flex-col gap-3 p-4">
							<Skeleton className="h-3 w-20" />
							<div className="flex gap-1.5">
								<Skeleton className="h-6 w-14 rounded-full" />
								<Skeleton className="h-6 w-20 rounded-full" />
								<Skeleton className="h-6 w-20 rounded-full" />
							</div>
							<Skeleton className="mt-2 h-3 w-20" />
							<div className="flex gap-1.5">
								<Skeleton className="h-6 w-20 rounded-full" />
								<Skeleton className="h-6 w-14 rounded-full" />
							</div>
						</div>
					</section>
					<section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
						<PanelHeaderSkeleton />
						<PreviewBodySkeleton />
					</section>
				</div>
			</div>
			{/* Mobile: full-height preview, drawer tab flush at the shell bottom. */}
			<div className="relative flex h-full flex-col md:hidden">
				<div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pt-6 pb-3">
					<HeaderSkeleton />
					<section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
						<PanelHeaderSkeleton />
						<PreviewBodySkeleton />
					</section>
				</div>
				<div className="flex shrink-0 justify-center">
					<div className="h-8 w-44 rounded-t-xl bg-muted" />
				</div>
			</div>
		</DashboardLayout>
	);
}
