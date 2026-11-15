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

export function AdminReposPageSkeleton() {
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
						aria-label="Repos"
						data-admin-table="repos"
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
									data-layout-size="search"
								>
									<Skeleton fill />
								</span>
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
