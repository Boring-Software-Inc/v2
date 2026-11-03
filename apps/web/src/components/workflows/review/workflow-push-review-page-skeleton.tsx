import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

export function WorkflowPushReviewPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<ReviewSkeleton />
		</DashboardLayout>
	);
}

export function ReviewSkeleton() {
	return (
		<Page>
			<PageHeader
				metadata={
					<SkeletonText
						data-layout-role="workflow-review-skeleton-metadata"
						type="body-sm"
					/>
				}
				title="Review push"
			/>
			<PageBody>
				<div aria-hidden data-layout-role="workflow-review-skeleton-section">
					<SkeletonText
						data-layout-role="workflow-review-skeleton-title"
						type="heading-sm"
					/>
					<div data-layout-role="workflow-review-skeleton-diff">
						<Skeleton />
					</div>
				</div>
			</PageBody>
		</Page>
	);
}
