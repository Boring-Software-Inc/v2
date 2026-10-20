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

export function AdminUsersPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full flex-col gap-6">
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-20" type="heading" />
						<SkeletonText className="max-w-measure" lines={2} type="body" />
					</header>
					<Table
						aria-busy
						aria-label="Users"
						toolbar={
							<>
								<Skeleton className="h-(--control-sm) w-64 rounded-pill" />
								<Skeleton className="ms-auto h-(--control-sm) w-56 rounded-pill" />
							</>
						}
					>
						<TableHeader>
							<TableRow>
								<TableHead />
								<TableHead>User</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Personal org</TableHead>
								<TableHead numeric>Orgs</TableHead>
								<TableHead>Joined</TableHead>
								<TableHead>No cooldown</TableHead>
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
								]}
								rows={6}
							/>
						</TableBody>
					</Table>
				</div>
			</div>
		</DashboardLayout>
	);
}
