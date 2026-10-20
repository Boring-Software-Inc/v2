import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "#/components/glaze/ui/table";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function AdminOrgsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full flex-col gap-6">
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-16" type="heading" />
						<SkeletonText className="w-96 max-w-full" type="body" />
					</header>
					<Table
						aria-busy
						aria-label="Orgs"
						toolbar={
							<>
								<Skeleton className="h-(--control-sm) w-48 rounded-pill" />
								<Skeleton className="ms-auto h-(--control-sm) w-56 rounded-pill" />
							</>
						}
					>
						<TableHeader>
							<TableRow>
								<TableHead>Org</TableHead>
								<TableHead>Kind</TableHead>
								<TableHead numeric>Members</TableHead>
								<TableHead numeric>Repos</TableHead>
								<TableHead>Created</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<TableLoading
								columns={[{}, {}, { numeric: true }, { numeric: true }, {}]}
								rows={6}
							/>
						</TableBody>
					</Table>
				</div>
			</div>
		</DashboardLayout>
	);
}
