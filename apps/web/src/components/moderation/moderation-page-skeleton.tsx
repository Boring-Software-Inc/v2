import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { ModerationPageFrame } from "#/components/moderation/moderation-page-frame";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/design-system/ui/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
} from "#/design-system/ui/item";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

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
			<ModerationPageFrame>
				<header data-layout-role="moderation-header">
					<SkeletonText className="w-36" type="heading" />
					<SkeletonText className="w-80" type="body" />
				</header>
				<div data-layout-role="moderation-workspace">
					<div data-layout-role="moderation-primary">
						<div data-layout-role="moderation-queue">
							<QueueSkeleton />
						</div>
					</div>
				</div>
			</ModerationPageFrame>
		</DashboardLayout>
	);
}
