import { Card, CardContent, CardFooter } from "@tripwire/ui/card";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";

export function NoOrgsPageSkeleton() {
	return (
		<div className="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
			<div aria-hidden className="flex w-full max-w-sm flex-col gap-6">
				<div className="flex flex-col gap-1">
					<span data-skeleton-line="" aria-hidden className="w-52">
						<SkeletonText type="heading" />
					</span>
					<span data-skeleton-line="" aria-hidden className="w-64">
						<SkeletonText type="body" />
					</span>
				</div>
				<Card>
					<CardContent data-layout-role="no-orgs-skeleton-content">
						<div className="flex flex-col gap-1.5">
							<span data-skeleton-line="" aria-hidden className="w-12">
								<SkeletonText type="label" />
							</span>
							<span
								data-skeleton-box=""
								aria-hidden
								className="h-(--control) w-full rounded-pill"
							>
								<Skeleton fill />
							</span>
						</div>
						<div className="flex flex-col gap-1.5">
							<span data-skeleton-line="" aria-hidden className="w-10">
								<SkeletonText type="label" />
							</span>
							<span
								data-skeleton-box=""
								aria-hidden
								className="h-(--control) w-full rounded-pill"
							>
								<Skeleton fill />
							</span>
							<span data-skeleton-line="" aria-hidden className="w-32">
								<SkeletonText type="body-sm" />
							</span>
						</div>
					</CardContent>
					<CardFooter>
						<span
							data-skeleton-box=""
							aria-hidden
							className="h-(--control-sm) w-24 rounded-pill"
						>
							<Skeleton fill />
						</span>
					</CardFooter>
				</Card>
			</div>
		</div>
	);
}
