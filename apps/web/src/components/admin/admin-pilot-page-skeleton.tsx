import { SkeletonText } from "@tripwire/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";

export function AdminPilotPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<header aria-hidden data-layout-role="admin-page-header-skeleton">
					<span data-skeleton-line="" aria-hidden data-layout-size="page-title">
						<SkeletonText type="heading" />
					</span>
					<span
						data-skeleton-line=""
						aria-hidden
						data-layout-size="page-description"
					>
						<SkeletonText type="body" />
					</span>
				</header>
				<PageBody>
					<span
						data-skeleton-line=""
						aria-hidden
						data-layout-size="section-title"
					>
						<SkeletonText type="heading" />
					</span>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
