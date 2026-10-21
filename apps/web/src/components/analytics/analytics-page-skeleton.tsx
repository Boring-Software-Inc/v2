import { Chart } from "#/components/glaze/ui/chart";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
} from "#/components/glaze/ui/item";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const EVENT_SLOTS = ["a", "b", "c", "d", "e"] as const;

export function AnalyticsBodySkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-6">
			<Skeleton className="h-(--control-sm) w-80 max-w-full rounded-pill" />
			<Chart
				config={{ hour: { label: "Hour" }, value: { label: "Value" } }}
				data={[]}
				label="Loading chart"
				loading
				type="line"
				xKey="hour"
			/>
			<div className="flex flex-col gap-2">
				<SkeletonText className="w-24" type="heading-sm" />
				<ItemGroup>
					{EVENT_SLOTS.map((slot) => (
						<Item className="py-2" key={slot}>
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
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<SkeletonText className="w-32" type="heading" />
					<AnalyticsBodySkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
