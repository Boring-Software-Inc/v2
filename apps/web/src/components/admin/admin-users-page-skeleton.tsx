import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";

const ROW_SLOTS = [
	{ key: "a", name: "w-28" },
	{ key: "b", name: "w-36" },
	{ key: "c", name: "w-24" },
	{ key: "d", name: "w-32" },
	{ key: "e", name: "w-28" },
	{ key: "f", name: "w-40" },
];

export function AdminUsersPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-5xl px-6 py-8">
				<header className="mb-6 flex flex-col gap-1.5">
					<Skeleton className="h-6 w-20" />
					<Skeleton className="h-4 w-80 max-w-full" />
				</header>
				<div className="mb-4 flex items-center gap-2">
					<Skeleton className="h-6 w-12 rounded-full" />
					<Skeleton className="h-6 w-16 rounded-full" />
					<Skeleton className="h-6 w-18 rounded-full" />
					<Skeleton className="h-6 w-16 rounded-full" />
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
							<Skeleton className="size-4" />
							<Skeleton className="size-5 rounded-full" />
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<Skeleton className={`h-3.5 ${slot.name}`} />
								<Skeleton className="h-3 w-44" />
							</div>
							<Skeleton className="h-3 w-16" />
							<Skeleton className="hidden h-3 w-20 sm:block" />
							<Skeleton className="hidden h-3 w-20 md:block" />
							<Skeleton className="h-6 w-28" />
						</div>
					))}
				</div>
			</div>
		</DashboardLayout>
	);
}
