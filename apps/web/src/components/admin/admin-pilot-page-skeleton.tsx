import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";
import { SkeletonText } from "#/design-system/ui/skeleton";

export function AdminPilotPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<header aria-hidden data-layout-role="admin-page-header-skeleton">
					<SkeletonText data-layout-size="page-title" type="heading" />
					<SkeletonText data-layout-size="page-description" type="body" />
				</header>
				<PageBody>
					<SkeletonText data-layout-size="section-title" type="heading" />
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
