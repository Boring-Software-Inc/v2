import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "@tripwire/ui/table";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";

export function AdminOrgsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<Page>
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
					<Table
						aria-busy
						aria-label="Orgs"
						data-admin-table="orgs"
						toolbar={
							<div aria-hidden data-layout-role="admin-table-toolbar-skeleton">
								<span
									data-skeleton-box=""
									aria-hidden
									data-layout-size="filter-medium"
								>
									<Skeleton fill />
								</span>
								<span
									data-skeleton-box=""
									aria-hidden
									data-layout-size="search"
								>
									<Skeleton fill />
								</span>
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
