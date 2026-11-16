import { Card, CardContent, CardHeader } from "@tripwire/ui/card";
import { Item, ItemContent, ItemGroup, ItemMedia } from "@tripwire/ui/item";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody } from "#/components/layouts/page";

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
						<span data-skeleton-line="" aria-hidden className="w-2/3">
							<SkeletonText type="label" />
						</span>
						<span data-skeleton-line="" aria-hidden className="w-48">
							<SkeletonText type="body-sm" />
						</span>
					</CardHeader>
					<CardContent flush>
						<ItemGroup variant="plain">
							{stack.rows.map((row) => (
								<Item key={row} density="compact">
									<ItemContent>
										<span data-skeleton-line="" aria-hidden className="w-56">
											<SkeletonText type="label" />
										</span>
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
							<span
								data-skeleton-box=""
								aria-hidden
								className="size-5 rounded-pill"
							>
								<Skeleton fill />
							</span>
						</ItemMedia>
						<ItemContent>
							<span data-skeleton-line="" aria-hidden className="w-1/2">
								<SkeletonText type="label" />
							</span>
							<span data-skeleton-line="" aria-hidden className="w-36">
								<SkeletonText type="body-sm" />
							</span>
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
			<Page purpose="task">
				<header data-layout-role="page-header">
					<div>
						<span data-skeleton-line="" aria-hidden className="w-28">
							<SkeletonText type="heading" />
						</span>
						<span data-skeleton-line="" aria-hidden className="w-80">
							<SkeletonText type="body" />
						</span>
					</div>
				</header>
				<PageBody>
					<span
						data-skeleton-box=""
						aria-hidden
						className="h-(--control-sm) w-80 max-w-full rounded-pill"
					>
						<Skeleton fill />
					</span>
					<ActivityListSkeleton />
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}
