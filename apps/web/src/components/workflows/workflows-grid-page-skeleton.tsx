import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";

export function GridSkeleton() {
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{["a", "b", "c", "d"].map((key) => (
				<Skeleton className="h-32 rounded-xl" key={key} />
			))}
		</div>
	);
}

export function WorkflowsGridPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-5 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
					<div className="flex flex-col gap-2">
						<Skeleton className="h-8 w-44" />
						<Skeleton className="h-4 w-80" />
					</div>
					<GridSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
