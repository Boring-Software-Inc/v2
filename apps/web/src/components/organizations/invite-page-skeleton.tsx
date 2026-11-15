import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { TripwireLogo } from "#/components/common/tripwire-logo";

export function InvitePageSkeleton() {
	return (
		<div className="flex min-h-dvh w-full items-center justify-center bg-page px-4 py-10">
			<div
				aria-hidden
				className="flex w-full max-w-sm flex-col items-center gap-6 text-center"
			>
				<TripwireLogo className="text-text-1" size={28} />
				<div className="flex w-full flex-col items-center gap-2">
					<span data-skeleton-line="" aria-hidden className="w-64">
						<SkeletonText type="heading" />
					</span>
					<span data-skeleton-line="" aria-hidden className="w-72">
						<SkeletonText lines={2} type="body" />
					</span>
				</div>
				<span
					data-skeleton-box=""
					aria-hidden
					className="h-(--control) w-24 rounded-pill"
				>
					<Skeleton fill />
				</span>
			</div>
		</div>
	);
}
