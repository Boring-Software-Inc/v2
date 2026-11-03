import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Chart } from "#/design-system/ui/chart";
import { SkeletonText } from "#/design-system/ui/skeleton";

export function OrgAnalyticsBodySkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-6">
			<SkeletonText className="w-96 max-w-full" type="body" />
			<Chart
				config={{ hour: { label: "Hour" }, events: { label: "Events" } }}
				data={[]}
				label="Loading chart"
				loading
				type="line"
				xKey="hour"
			/>
		</div>
	);
}

export function OrgAnalyticsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-32" type="heading" />
						<SkeletonText className="w-80 max-w-full" type="body" />
					</header>
					<OrgAnalyticsBodySkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
