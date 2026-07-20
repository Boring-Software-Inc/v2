import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function AnalyticsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-4xl px-6 py-8 md:px-8 md:py-10">
				<div className="mb-6 h-8 w-40 animate-pulse rounded-md bg-surface-1" />
				<div className="mb-6 h-56 animate-pulse rounded-lg bg-surface-1" />
				<div className="flex flex-col gap-2">
					{Array.from({ length: 5 }, (_, i) => `analytics-skel-${i}`).map(
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
