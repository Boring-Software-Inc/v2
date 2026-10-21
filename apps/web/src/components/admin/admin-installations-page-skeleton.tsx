import { SkeletonText } from "#/components/glaze/ui/skeleton";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableLoading,
	TableRow,
} from "#/components/glaze/ui/table";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function AdminInstallationsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-312 flex-col gap-6">
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-32" type="heading" />
						<SkeletonText className="w-80 max-w-full" type="body" />
					</header>
					<Table aria-busy aria-label="Installations">
						<TableHeader>
							<TableRow>
								<TableHead>Account</TableHead>
								<TableHead>Org</TableHead>
								<TableHead numeric>Repos</TableHead>
								<TableHead numeric>Protected</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<TableLoading
								columns={[{}, {}, { numeric: true }, { numeric: true }]}
								rows={6}
							/>
						</TableBody>
					</Table>
				</div>
			</div>
		</DashboardLayout>
	);
}
