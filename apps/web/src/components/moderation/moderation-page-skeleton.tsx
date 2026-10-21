import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/glaze/ui/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
} from "#/components/glaze/ui/item";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const QUEUE_SLOTS = ["a", "b", "c", "d", "e", "f"];

export function QueueSkeleton() {
	return (
		<Card aria-hidden>
			<CardHeader>
				<CardTitle>
					<SkeletonText className="w-32" type="label" />
				</CardTitle>
			</CardHeader>
			<CardContent flush>
				<ItemGroup variant="plain">
					{QUEUE_SLOTS.map((slot) => (
						<Item key={slot}>
							<ItemMedia variant="icon">
								<Skeleton className="size-(--icon) rounded-tag" />
							</ItemMedia>
							<ItemContent>
								<SkeletonText className="w-2/3" type="label" />
								<SkeletonText className="w-1/2" type="body-sm" />
							</ItemContent>
							<ItemActions className="me-0 gap-2">
								<Skeleton className="h-(--control-sm) w-16 rounded-pill" />
								<Skeleton className="h-(--control-sm) w-22 rounded-pill" />
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			</CardContent>
		</Card>
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
