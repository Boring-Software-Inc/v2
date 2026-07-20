import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";

const ROW_SLOTS = [
	{ key: "a", name: "w-32" },
	{ key: "b", name: "w-24" },
	{ key: "c", name: "w-40" },
	{ key: "d", name: "w-28" },
	{ key: "e", name: "w-36" },
	{ key: "f", name: "w-24" },
];

export function AdminOrgsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-5xl px-6 py-8">
				<header className="mb-6 flex flex-col gap-1.5">
					<Skeleton className="h-6 w-16" />
					<Skeleton className="h-4 w-80 max-w-full" />
				</header>
				<div className="mb-4 flex items-center gap-2">
					<Skeleton className="h-6 w-12 rounded-full" />
					<Skeleton className="h-6 w-14 rounded-full" />
					<Skeleton className="h-6 w-18 rounded-full" />
					<Skeleton className="ml-auto h-8 w-56" />
				</div>
				<div className="overflow-hidden rounded-xl border bg-card">
					<div className="bg-surface-1 px-4 py-2">
						<Skeleton className="h-3 w-full max-w-md" />
					</div>
					{ROW_SLOTS.map((slot) => (
						<div
							className="flex items-center gap-3 border-t px-4 py-2.5"
							key={slot.key}
						>
							<Skeleton className="size-5 rounded-md" />
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<Skeleton className={`h-3.5 ${slot.name}`} />
								<Skeleton className="h-3 w-20" />
							</div>
							<Skeleton className="h-3 w-12" />
							<Skeleton className="h-3 w-10" />
							<Skeleton className="hidden h-3 w-20 md:block" />
						</div>
					))}
				</div>
			</div>
		</DashboardLayout>
	);
}
