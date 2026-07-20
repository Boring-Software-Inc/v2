import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";

export function HomeListSkeleton() {
	return (
		<div className="flex flex-col gap-1">
			{["a", "b", "c", "d", "e"].map((slot) => (
				<Skeleton className="h-14 rounded-lg" key={slot} />
			))}
		</div>
	);
}

export function OrgHomePageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-5 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
					<header className="flex flex-col gap-1.5">
						<Skeleton className="h-8 w-32" />
						<Skeleton className="h-5 w-72" />
					</header>
					<HomeListSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
