import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";

const CARD_SLOTS = ["cost", "metered", "drift", "runs"];

export function EconomicsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-4xl px-6 py-8">
				<header className="mb-6 flex flex-col gap-1.5">
					<Skeleton className="h-6 w-32" />
					<Skeleton className="h-4 w-64 max-w-full" />
				</header>
				<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
					{CARD_SLOTS.map((key) => (
						<div className="rounded-xl border bg-card px-4 py-3" key={key}>
							<Skeleton className="mb-1.5 h-3 w-24" />
							<Skeleton className="h-6 w-16" />
						</div>
					))}
				</div>
				<div className="mt-6 grid gap-3 md:grid-cols-2">
					<Skeleton className="h-36 w-full rounded-xl" />
					<Skeleton className="h-36 w-full rounded-xl" />
				</div>
				<Skeleton className="mt-3 h-20 w-full rounded-xl" />
				<Skeleton className="mt-6 h-64 w-full rounded-xl" />
			</div>
		</DashboardLayout>
	);
}
