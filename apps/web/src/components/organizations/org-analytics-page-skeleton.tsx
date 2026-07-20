import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";

export function StatGridSkeleton() {
	return (
		<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
			{["a", "b", "c", "d", "e"].map((slot) => (
				<Skeleton className="h-20 rounded-xl" key={slot} />
			))}
		</div>
	);
}

export function OrgAnalyticsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-5 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
					<header className="flex flex-col gap-1.5">
						<Skeleton className="h-8 w-40" />
						<Skeleton className="h-5 w-80" />
					</header>
					<StatGridSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
