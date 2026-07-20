import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function ActivityPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-3xl px-6 py-8">
				<div className="mb-6 h-8 w-40 animate-pulse rounded-md bg-surface-1" />
				<div className="flex flex-col gap-2">
					{Array.from({ length: 8 }, (_, i) => `activity-skel-${i}`).map(
						(key) => (
							<div
								className="h-11 animate-pulse rounded-md bg-surface-1"
								key={key}
							/>
						),
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}
