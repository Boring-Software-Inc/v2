import { DashboardLayout } from "#/components/layouts/dashboard-layout";

export function RulesPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="mx-auto w-full max-w-4xl px-6 py-8">
				<div className="mb-6 h-8 w-40 animate-pulse rounded-md bg-surface-1" />
				<div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
					{Array.from({ length: 4 }, (_, i) => `stat-skel-${i}`).map((key) => (
						<div
							className="h-24 animate-pulse rounded-xl bg-surface-1"
							key={key}
						/>
					))}
				</div>
				<div className="flex flex-col gap-3">
					{Array.from({ length: 5 }, (_, i) => `rules-skel-${i}`).map((key) => (
						<div
							className="h-24 animate-pulse rounded-lg bg-surface-1"
							key={key}
						/>
					))}
				</div>
			</div>
		</DashboardLayout>
	);
}
