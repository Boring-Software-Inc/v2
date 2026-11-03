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

export function AdminUsersPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<Page>
				<header aria-hidden data-layout-role="admin-page-header-skeleton">
					<SkeletonText data-layout-size="page-title" type="heading" />
					<SkeletonText
						data-layout-size="page-description-long"
						lines={2}
						type="body"
					/>
				</header>
				<PageBody>
					<Table
						aria-busy
						aria-label="Users"
						data-admin-table="users"
						toolbar={
							<div aria-hidden data-layout-role="admin-table-toolbar-skeleton">
								<Skeleton data-layout-size="filter-wide" />
								<Skeleton data-layout-size="filter-short" />
								<Skeleton data-layout-size="search" />
							</div>
						}
					>
						<TableHeader>
							<TableRow>
								<TableHead />
								<TableHead>User</TableHead>
								<TableHead>Status</TableHead>
								<TableHead data-admin-column="user-personal-org">
									Personal org
								</TableHead>
								<TableHead data-admin-column="user-org-count" numeric>
									Orgs
								</TableHead>
								<TableHead data-admin-column="user-joined">Joined</TableHead>
								<TableHead data-admin-column="user-last-seen">
									Last seen
								</TableHead>
								<TableHead>Skip cooldown</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							<TableLoading
								columns={[
									{ checkbox: true },
									{},
									{},
									{},
									{ numeric: true },
									{},
									{},
									{},
									{},
								]}
								rows={6}
							/>
						</TableBody>
					</Table>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
