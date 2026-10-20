import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
} from "#/components/glaze/ui/item";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const QUEUE_SLOTS = ["a", "b", "c", "d", "e", "f"];

export function QueueSkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-2">
			<SkeletonText className="w-24" type="heading-sm" />
			<ItemGroup>
				{QUEUE_SLOTS.map((slot) => (
					<Item key={slot}>
						<ItemContent>
							<SkeletonText className="w-2/3" type="label" />
							<SkeletonText className="w-20" type="body-sm" />
						</ItemContent>
						<ItemActions>
							<Skeleton className="h-(--control-sm) w-12 rounded-pill" />
							<Skeleton className="h-(--control-sm) w-16 rounded-pill" />
						</ItemActions>
					</Item>
				))}
			</ItemGroup>
		</div>
	);
}

export function ModerationPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-36" type="heading" />
						<SkeletonText className="w-80" type="body" />
					</header>
					<QueueSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
