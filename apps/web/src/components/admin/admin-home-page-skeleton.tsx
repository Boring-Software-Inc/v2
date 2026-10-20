import { EntityCardSkeleton } from "#/components/common/entity-card-skeleton";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";

const ROW_SLOTS = ["users", "orgs", "economics"] as const;

export function AdminHomePageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-4 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<header className="flex flex-col gap-1">
						<SkeletonText className="w-24" type="heading" />
						<SkeletonText className="w-96 max-w-full" type="body" />
					</header>
					<div aria-hidden className="flex flex-col gap-3">
						{ROW_SLOTS.map((slot) => (
							<EntityCardSkeleton key={slot} />
						))}
					</div>
				</div>
			</div>
		</DashboardLayout>
	);
}
