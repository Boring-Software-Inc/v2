import { BrandLockup } from "#/components/auth/brand-lockup";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { SlowRegion } from "#/components/glaze/ui/slow-notice";

export function InstallSetupPageSkeleton() {
	return (
		<div className="relative flex min-h-dvh w-full justify-center bg-page px-4 py-10 md:items-center">
			<SlowRegion>
				<div aria-hidden className="flex w-full max-w-md flex-col gap-6">
					<div className="flex justify-center">
						<BrandLockup />
					</div>
					<div className="flex flex-col items-center gap-2">
						<SkeletonText className="w-64" type="heading" />
						<SkeletonText className="w-80" type="body" />
					</div>
					<Card>
						<CardContent className="flex flex-col gap-3">
							<SkeletonText className="w-48" type="label" />
							<SkeletonText className="w-40" type="label" />
						</CardContent>
					</Card>
					<div className="flex justify-end gap-2">
						<Skeleton className="h-(--control) w-40 rounded-pill" />
						<Skeleton className="h-(--control) w-32 rounded-pill" />
					</div>
				</div>
			</SlowRegion>
		</div>
	);
}
