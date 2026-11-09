import { AdminOverviewStats } from "#/components/admin/admin-overview-stats";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";
import {
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemTitle,
} from "#/design-system/ui/item";
import { SkeletonText } from "#/design-system/ui/skeleton";

const ROW_SLOTS = ["users", "orgs", "repos", "installations", "pilot"] as const;

export function AdminHomePageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<Page purpose="task">
				<header aria-hidden data-layout-role="admin-page-header-skeleton">
					<SkeletonText data-layout-size="page-title" type="heading" />
					<SkeletonText data-layout-size="page-description" type="body" />
				</header>
				<PageBody>
					<Section id="admin-summary-skeleton">
						<SectionHeader title="Product at a glance" />
						<SectionBody>
							<AdminOverviewStats overview={undefined} />
						</SectionBody>
					</Section>
					<Section id="admin-sections-skeleton">
						<SectionHeader title="Staff tools" />
						<SectionBody>
							<ItemGroup aria-hidden>
								{ROW_SLOTS.map((slot) => (
									<Item key={slot}>
										<ItemContent>
											<ItemTitle>
												<SkeletonText
													data-layout-size="section-title"
													type="label"
												/>
											</ItemTitle>
											<SkeletonText
												data-layout-size="section-description"
												type="body-sm"
											/>
										</ItemContent>
									</Item>
								))}
							</ItemGroup>
						</SectionBody>
					</Section>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
