import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { ContributionAppealLayout } from "#/components/layouts/contribution-appeal-layout";

export function AppealPageSkeleton() {
	return (
		<ContributionAppealLayout loading>
			<span data-skeleton-line="" aria-hidden className="w-56">
				<SkeletonText type="heading" />
			</span>
			<span data-skeleton-line="" aria-hidden className="w-full">
				<SkeletonText type="body" />
			</span>
			<span
				data-skeleton-box=""
				aria-hidden
				className="h-(--control) w-32 rounded-pill"
			>
				<Skeleton fill />
			</span>
		</ContributionAppealLayout>
	);
}
