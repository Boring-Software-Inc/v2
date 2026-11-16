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

export function AdminUsersPageSkeleton() {
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
						data-layout-size="page-description-long"
					>
						<SkeletonText lines={2} type="body" />
					</span>
				</header>
				<PageBody>
					<Table
						aria-busy
						aria-label="Users"
						data-admin-table="users"
						toolbar={
							<div aria-hidden data-layout-role="admin-table-toolbar-skeleton">
								<span
									data-skeleton-box=""
									aria-hidden
									data-layout-size="filter-wide"
								>
									<Skeleton fill />
								</span>
								<span
									data-skeleton-box=""
									aria-hidden
									data-layout-size="filter-short"
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
