import { Card, CardContent, CardHeader, CardTitle } from "@tripwire/ui/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
} from "@tripwire/ui/item";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { ModerationPageFrame } from "#/components/moderation/moderation-page-frame";

const QUEUE_SLOTS = ["a", "b", "c", "d", "e", "f"];

export function QueueSkeleton() {
	return (
		<Card aria-hidden>
			<CardHeader>
				<CardTitle>
					<span data-skeleton-line="" aria-hidden className="w-32">
						<SkeletonText type="label" />
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent flush>
				<ItemGroup variant="plain">
					{QUEUE_SLOTS.map((slot) => (
						<Item key={slot}>
							<ItemMedia variant="icon">
								<span
									data-skeleton-box=""
									aria-hidden
									className="size-(--icon) rounded-tag"
								>
									<Skeleton fill />
								</span>
							</ItemMedia>
							<ItemContent>
								<span data-skeleton-line="" aria-hidden className="w-2/3">
									<SkeletonText type="label" />
								</span>
								<span data-skeleton-line="" aria-hidden className="w-1/2">
									<SkeletonText type="body-sm" />
								</span>
							</ItemContent>
							<ItemActions data-layout-role="moderation-skeleton-actions">
								<span
									data-skeleton-box=""
									aria-hidden
									className="h-(--control-sm) w-16 rounded-pill"
								>
									<Skeleton fill />
								</span>
								<span
									data-skeleton-box=""
									aria-hidden
									className="h-(--control-sm) w-22 rounded-pill"
								>
									<Skeleton fill />
								</span>
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
					<span data-skeleton-line="" aria-hidden className="w-36">
						<SkeletonText type="heading" />
					</span>
					<span data-skeleton-line="" aria-hidden className="w-80">
						<SkeletonText type="body" />
					</span>
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
