import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";
import { SkeletonText } from "#/design-system/ui/skeleton";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "#/design-system/ui/table";

export function AdminInstallationsPageSkeleton() {
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
						aria-label="Installations"
						data-admin-table="installations"
					>
						<TableHeader>
							<TableRow>
								<TableHead>Account</TableHead>
								<TableHead data-admin-column="installation-org">Org</TableHead>
								<TableHead data-admin-column="installation-repos" numeric>
									Repos
								</TableHead>
								<TableHead data-admin-column="installation-protected" numeric>
									Protected
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<TableLoading
								columns={[{}, {}, { numeric: true }, { numeric: true }]}
								rows={6}
							/>
						</TableBody>
					</Table>
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
