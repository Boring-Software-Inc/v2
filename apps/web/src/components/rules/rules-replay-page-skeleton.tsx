import { Card, CardContent } from "#/components/glaze/ui/card";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const ROW_SLOTS = ["a", "b", "c", "d", "e"];

export function ReplayListSkeleton() {
	return (
		<Card aria-hidden>
			<CardContent flush>
				<ul>
					{ROW_SLOTS.map((slot) => (
						<li
							className="grid grid-cols-[--spacing(12)_minmax(0,1fr)_--spacing(28)] items-center gap-x-3 px-3 py-3 not-first:border-line-faint not-first:border-t"
							key={slot}
						>
							<SkeletonText className="w-8" type="body-sm" />
							<span className="flex flex-col gap-1">
								<SkeletonText className="w-2/3" type="body" />
								<SkeletonText className="w-1/3" type="body-sm" />
							</span>
							<Skeleton className="h-(--icon-sm) w-16 rounded-tag" />
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

export function RulesReplayPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-64" type="heading" />
						<SkeletonText className="w-72" type="body" />
					</header>
					<ReplayListSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
