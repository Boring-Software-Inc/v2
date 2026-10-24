import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export const REVIEW_FRAME =
	"mx-auto flex w-full max-w-5xl flex-col gap-6 px-3 pt-6 pb-24 sm:px-6";

export function WorkflowPushReviewPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<ReviewSkeleton />
		</DashboardLayout>
	);
}

export function ReviewSkeleton() {
	return (
		<div aria-hidden className={REVIEW_FRAME}>
			<div className="flex flex-col gap-2">
				<SkeletonText className="w-40" type="heading" />
				<SkeletonText className="w-72" type="body-sm" />
			</div>
			<div className="flex flex-col gap-3">
				<SkeletonText className="w-32" type="heading-sm" />
				<Skeleton className="h-72 w-full rounded-lg" />
			</div>
		</div>
	);
}
