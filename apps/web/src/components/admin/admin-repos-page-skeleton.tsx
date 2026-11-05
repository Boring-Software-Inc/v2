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

export function AdminReposPageSkeleton() {
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
						aria-label="Repos"
						data-admin-table="repos"
						toolbar={
							<div aria-hidden data-layout-role="admin-table-toolbar-skeleton">
								<Skeleton data-layout-size="filter-wide" />
								<Skeleton data-layout-size="search" />
							</div>
						}
					>
						<TableHeader>
							<TableRow>
								<TableHead>Repo</TableHead>
								<TableHead data-admin-column="repo-org">Org</TableHead>
								<TableHead>Tripwire</TableHead>
								<TableHead data-admin-column="repo-added">Added</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<TableLoading columns={[{}, {}, {}, {}]} rows={6} />
						</TableBody>
					</Table>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
