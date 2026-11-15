import { Card, CardContent } from "@tripwire/ui/card";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { BrandLockup } from "#/components/auth/brand-lockup";

export function InstallSetupPageSkeleton() {
	return (
		<div className="flex min-h-dvh w-full justify-center bg-page px-4 py-10 md:items-center">
			<div aria-hidden className="flex w-full max-w-md flex-col gap-6">
				<div className="flex justify-center">
					<BrandLockup />
				</div>
				<div className="flex flex-col items-center gap-2">
					<span data-skeleton-line="" aria-hidden className="w-64">
						<SkeletonText type="heading" />
					</span>
					<span data-skeleton-line="" aria-hidden className="w-80">
						<SkeletonText type="body" />
					</span>
				</div>
				<Card>
					<CardContent data-layout-role="install-setup-skeleton-content">
						<span data-skeleton-line="" aria-hidden className="w-48">
							<SkeletonText type="label" />
						</span>
						<span data-skeleton-line="" aria-hidden className="w-40">
							<SkeletonText type="label" />
						</span>
					</CardContent>
				</Card>
				<div className="flex justify-end gap-2">
					<span
						data-skeleton-box=""
						aria-hidden
						className="h-(--control) w-40 rounded-pill"
					>
						<Skeleton fill />
					</span>
					<span
						data-skeleton-box=""
						aria-hidden
						className="h-(--control) w-32 rounded-pill"
					>
						<Skeleton fill />
					</span>
				</div>
			</div>
		</div>
	);
}
