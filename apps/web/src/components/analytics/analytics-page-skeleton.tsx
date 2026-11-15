import { Item, ItemContent, ItemGroup, ItemMedia } from "@tripwire/ui/item";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { Chart } from "#/components/common/chart";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const EVENT_SLOTS = ["a", "b", "c", "d", "e"] as const;

export function AnalyticsBodySkeleton() {
	return (
		<div aria-hidden data-layout-role="analytics-skeleton-body">
			<span
				data-skeleton-box=""
				aria-hidden
				className="h-(--control-sm) w-80 max-w-full rounded-pill"
			>
				<Skeleton fill />
			</span>
			<Chart
				config={{ hour: { label: "Hour" }, value: { label: "Value" } }}
				data={[]}
				label="Loading chart"
				loading
				type="line"
				xKey="hour"
			/>
			<div data-layout-role="analytics-skeleton-events">
				<span data-skeleton-line="" aria-hidden className="w-24">
					<SkeletonText type="heading-sm" />
				</span>
				<ItemGroup>
					{EVENT_SLOTS.map((slot) => (
						<Item data-layout-role="analytics-skeleton-event" key={slot}>
							<ItemMedia variant="icon">
								<span
									data-skeleton-box=""
									aria-hidden
									className="size-(--icon)"
								>
									<Skeleton fill />
								</span>
							</ItemMedia>
							<ItemContent>
								<SkeletonText type="label" />
								<SkeletonText type="body-sm" />
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			</div>
		</div>
	);
}

export function AnalyticsPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div data-layout-role="page-skeleton-shell">
				<div data-layout-role="page-skeleton-body">
					<span data-skeleton-line="" aria-hidden className="w-32">
						<SkeletonText type="heading" />
					</span>
					<AnalyticsBodySkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
