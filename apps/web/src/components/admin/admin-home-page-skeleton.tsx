import { Item, ItemContent, ItemGroup, ItemTitle } from "@tripwire/ui/item";
import { SkeletonText } from "@tripwire/ui/skeleton";
import { AdminOverviewStats } from "#/components/admin/admin-overview-stats";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";
import {
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";

const ROW_SLOTS = ["users", "orgs", "repos", "installations", "pilot"] as const;

export function AdminHomePageSkeleton() {
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
					<Section id="admin-summary-skeleton">
						<SectionHeader title="Product at a glance" />
						<SectionBody>
							<AdminOverviewStats overview={undefined} />
						</SectionBody>
					</Section>
					<Section id="admin-sections-skeleton">
						<SectionHeader title="Staff tools" />
						<SectionBody>
							<ItemGroup aria-hidden data-layout-role="admin-dashboard-list">
								{ROW_SLOTS.map((slot) => (
									<Item key={slot}>
										<ItemContent>
											<ItemTitle>
												<span
													data-skeleton-line=""
													aria-hidden
													data-layout-size="section-title"
												>
													<SkeletonText type="label" />
												</span>
											</ItemTitle>
											<span
												data-skeleton-line=""
												aria-hidden
												data-layout-size="section-description"
											>
												<SkeletonText type="body-sm" />
											</span>
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
