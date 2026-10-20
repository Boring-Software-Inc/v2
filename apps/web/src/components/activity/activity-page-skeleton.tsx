import { Card, CardContent, CardHeader } from "#/components/glaze/ui/card";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
} from "#/components/glaze/ui/item";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const STACK_SLOTS = [
	{ key: "stack-a", rows: ["r1", "r2", "r3"] },
	{ key: "stack-b", rows: ["r1", "r2"] },
];

const ROW_SLOTS = ["row-a", "row-b"];

export function ActivityListSkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-3">
			{STACK_SLOTS.map((stack) => (
				<Card key={stack.key}>
					<CardHeader>
						<SkeletonText className="w-2/3" type="label" />
						<SkeletonText className="w-48" type="body-sm" />
					</CardHeader>
					<CardContent flush>
						<ItemGroup variant="plain">
							{stack.rows.map((row) => (
								<Item key={row} size="sm">
									<ItemContent>
										<SkeletonText className="w-56" type="label" />
									</ItemContent>
								</Item>
							))}
						</ItemGroup>
					</CardContent>
				</Card>
			))}
			<ItemGroup>
				{ROW_SLOTS.map((row) => (
					<Item key={row}>
						<ItemMedia>
							<Skeleton className="size-5 rounded-pill" />
						</ItemMedia>
						<ItemContent>
							<SkeletonText className="w-1/2" type="label" />
							<SkeletonText className="w-36" type="body-sm" />
						</ItemContent>
					</Item>
				))}
			</ItemGroup>
		</div>
	);
}

export function ActivityPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-28" type="heading" />
						<SkeletonText className="w-80" type="body" />
					</header>
					<Skeleton className="h-(--control-sm) w-80 max-w-full rounded-pill" />
					<ActivityListSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
