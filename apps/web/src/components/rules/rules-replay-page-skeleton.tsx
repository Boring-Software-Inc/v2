import { Card, CardContent } from "@tripwire/ui/card";
import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";
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
							<span data-skeleton-line="" aria-hidden className="w-8">
								<SkeletonText type="body-sm" />
							</span>
							<span className="flex flex-col gap-1">
								<span data-skeleton-line="" aria-hidden className="w-2/3">
									<SkeletonText type="body" />
								</span>
								<span data-skeleton-line="" aria-hidden className="w-1/3">
									<SkeletonText type="body-sm" />
								</span>
							</span>
							<span
								data-skeleton-box=""
								aria-hidden
								className="h-(--icon-sm) w-16 rounded-tag"
							>
								<Skeleton fill />
							</span>
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
						<span data-skeleton-line="" aria-hidden className="w-64">
							<SkeletonText type="heading" />
						</span>
						<span data-skeleton-line="" aria-hidden className="w-72">
							<SkeletonText type="body" />
						</span>
					</header>
					<ReplayListSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}
