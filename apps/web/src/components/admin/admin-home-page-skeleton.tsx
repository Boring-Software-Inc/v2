import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";

const STAT_SLOTS = ["pending", "approved", "orgs", "repos"];

export function AdminHomePageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-4xl px-6 py-8">
				<header className="mb-6 flex flex-col gap-1.5">
					<Skeleton className="h-6 w-24" />
					<Skeleton className="h-4 w-64 max-w-full" />
				</header>
				<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
					{STAT_SLOTS.map((key) => (
						<div className="rounded-xl border bg-card px-4 py-3" key={key}>
							<Skeleton className="mb-1.5 h-3 w-20" />
							<Skeleton className="h-6 w-10" />
						</div>
					))}
				</div>
				<div className="mt-6 flex flex-col gap-3">
					<Skeleton className="h-16 w-full rounded-xl" />
					<Skeleton className="h-16 w-full rounded-xl" />
				</div>
			</div>
		</DashboardLayout>
	);
}
