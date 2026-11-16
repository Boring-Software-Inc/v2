import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";

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
					<span
						data-skeleton-line=""
						aria-hidden
						data-layout-role="workflow-review-skeleton-metadata"
					>
						<SkeletonText type="body-sm" />
					</span>
				}
				title="Review push"
			/>
			<PageBody>
				<div aria-hidden data-layout-role="workflow-review-skeleton-section">
					<span
						data-skeleton-line=""
						aria-hidden
						data-layout-role="workflow-review-skeleton-title"
					>
						<SkeletonText type="heading-sm" />
					</span>
					<div data-layout-role="workflow-review-skeleton-diff">
						<Skeleton />
					</div>
				</div>
			</PageBody>
		</Page>
	);
}
