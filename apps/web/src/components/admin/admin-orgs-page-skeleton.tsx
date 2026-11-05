import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "#/design-system/ui/table";

export function AdminOrgsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<Page>
				<header aria-hidden data-layout-role="admin-page-header-skeleton">
					<SkeletonText data-layout-size="page-title" type="heading" />
					<SkeletonText data-layout-size="page-description" type="body" />
				</header>
				<PageBody>
					<Table
						aria-busy
						aria-label="Orgs"
						data-admin-table="orgs"
						toolbar={
							<div aria-hidden data-layout-role="admin-table-toolbar-skeleton">
								<Skeleton data-layout-size="filter-medium" />
								<Skeleton data-layout-size="search" />
							</div>
						}
					>
						<TableHeader>
							<TableRow>
								<TableHead>Org</TableHead>
								<TableHead>Kind</TableHead>
								<TableHead numeric>Members</TableHead>
								<TableHead data-admin-column="org-repos" numeric>
									Repos
								</TableHead>
								<TableHead data-admin-column="org-created">Created</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<TableLoading
								columns={[{}, {}, { numeric: true }, { numeric: true }, {}]}
								rows={6}
							/>
						</TableBody>
					</Table>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
