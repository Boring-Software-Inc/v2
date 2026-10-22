import { Card, CardContent, CardFooter } from "#/components/glaze/ui/card";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { SlowRegion } from "#/components/glaze/ui/slow-notice";

export function NoOrgsPageSkeleton() {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-page px-4 py-10">
			<SlowRegion className="pb-6 text-center">
				<div aria-hidden className="flex w-full max-w-sm flex-col gap-6">
					<div className="flex flex-col gap-1">
						<SkeletonText className="w-52" type="heading" />
						<SkeletonText className="w-64" type="body" />
					</div>
					<Card>
						<CardContent className="gap-4">
							<div className="flex flex-col gap-1.5">
								<SkeletonText className="w-12" type="label" />
								<Skeleton className="h-(--control) w-full rounded-pill" />
							</div>
							<div className="flex flex-col gap-1.5">
								<SkeletonText className="w-10" type="label" />
								<Skeleton className="h-(--control) w-full rounded-pill" />
								<SkeletonText className="w-32" type="body-sm" />
							</div>
						</CardContent>
						<CardFooter>
							<Skeleton className="h-(--control-sm) w-24 rounded-pill" />
						</CardFooter>
					</Card>
				</div>
			</SlowRegion>
		</div>
	);
}
