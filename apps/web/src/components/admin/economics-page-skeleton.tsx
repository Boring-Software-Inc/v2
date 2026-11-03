import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";
import {
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

export function EconomicsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<header aria-hidden data-layout-role="admin-page-header-skeleton">
					<SkeletonText data-layout-size="page-title" type="heading" />
					<SkeletonText
						data-layout-size="page-description-long"
						lines={2}
						type="body"
					/>
				</header>
				<PageBody>
					<Section id="economics-month-skeleton">
						<SectionHeader title="This month" />
						<SectionBody>
							<SkeletonText
								data-layout-size="economics-lead"
								type="heading-sm"
							/>
							<Skeleton data-layout-role="economics-summary-skeleton" />
						</SectionBody>
					</Section>
					<div data-layout-role="economics-charts">
						<Skeleton data-layout-role="economics-chart-skeleton" />
						<Skeleton data-layout-role="economics-chart-skeleton" />
					</div>
					<Skeleton data-layout-role="economics-table-skeleton" />
					<Skeleton data-layout-role="economics-table-skeleton" />
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
