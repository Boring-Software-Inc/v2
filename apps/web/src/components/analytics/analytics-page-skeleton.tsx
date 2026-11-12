import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Chart } from "#/design-system/ui/chart";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
} from "#/design-system/ui/item";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

const EVENT_SLOTS = ["a", "b", "c", "d", "e"] as const;

export function AnalyticsBodySkeleton() {
	return (
		<div aria-hidden data-layout-role="analytics-skeleton-body">
			<Skeleton className="h-(--control-sm) w-80 max-w-full rounded-pill" />
			<Chart
				config={{ hour: { label: "Hour" }, value: { label: "Value" } }}
				data={[]}
				label="Loading chart"
				loading
				type="line"
				xKey="hour"
			/>
			<div data-layout-role="analytics-skeleton-events">
				<SkeletonText className="w-24" type="heading-sm" />
				<ItemGroup>
					{EVENT_SLOTS.map((slot) => (
						<Item data-layout-role="analytics-skeleton-event" key={slot}>
							<ItemMedia variant="icon">
								<Skeleton className="size-(--icon)" />
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
					<SkeletonText className="w-32" type="heading" />
					<AnalyticsBodySkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
