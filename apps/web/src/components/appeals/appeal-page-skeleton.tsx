import { ContributionAppealLayout } from "#/components/layouts/contribution-appeal-layout";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

export function AppealPageSkeleton() {
	return (
		<ContributionAppealLayout loading>
			<SkeletonText className="w-56" type="heading" />
			<SkeletonText className="w-full" type="body" />
			<Skeleton className="h-(--control) w-32 rounded-pill" />
		</ContributionAppealLayout>
	);
}
