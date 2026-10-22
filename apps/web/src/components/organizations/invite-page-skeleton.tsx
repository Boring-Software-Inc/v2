import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { SlowRegion } from "#/components/glaze/ui/slow-notice";

export function InvitePageSkeleton() {
	return (
		<div className="flex min-h-dvh w-full flex-col items-center justify-center bg-page px-4 py-10">
			<SlowRegion className="pb-6 text-center">
				<div
					aria-hidden
					className="flex w-full max-w-sm flex-col items-center gap-6 text-center"
				>
					<TripwireLogo className="text-text-1" size={28} />
					<div className="flex w-full flex-col items-center gap-2">
						<SkeletonText className="w-64" type="heading" />
						<SkeletonText className="w-72" lines={2} type="body" />
					</div>
					<Skeleton className="h-(--control) w-24 rounded-pill" />
				</div>
			</SlowRegion>
		</div>
	);
}
