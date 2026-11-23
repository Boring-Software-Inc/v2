import { Skeleton, SkeletonText } from "@tripwire/ui/skeleton";

const NAVIGATION_ROWS = [
	{ id: "primary", width: "w-24" },
	{ id: "activity", width: "w-20" },
	{ id: "rules", width: "w-28" },
	{ id: "workflows", width: "w-24" },
	{ id: "responses", width: "w-24" },
	{ id: "analytics", width: "w-20" },
];

function SkeletonBox({ className }: { className: string }) {
	return (
		<span className={className}>
			<Skeleton fill />
		</span>
	);
}

function SkeletonLine({ className }: { className: string }) {
	return (
		<span className={className}>
			<SkeletonText type="label" />
		</span>
	);
}

export function DashboardRailNavSkeleton({
	condensed,
}: {
	condensed: boolean;
}) {
	return (
		<div
			aria-hidden
			className={
				condensed ? "flex flex-col items-center gap-2" : "flex flex-col gap-1"
			}
			data-layout-role="dashboard-rail-nav-skeleton"
		>
			{NAVIGATION_ROWS.map((row) =>
				condensed ? (
					<SkeletonBox className="size-[34px] rounded-tag" key={row.id} />
				) : (
					<div className="flex h-[34px] items-center gap-2 px-2" key={row.id}>
						<SkeletonBox className="size-4 rounded-tag" />
						<SkeletonLine className={row.width} />
					</div>
				),
			)}
		</div>
	);
}

export function DashboardRailSkeleton({ condensed }: { condensed: boolean }) {
	if (condensed) {
		return (
			<>
				<div
					aria-hidden
					className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-hidden"
					data-condensed="true"
					data-layout-role="dashboard-rail-skeleton"
				>
					<SkeletonBox className="size-[34px] rounded-tag" />
					<DashboardRailNavSkeleton condensed />
				</div>
				<div aria-hidden className="mt-auto flex flex-col items-center gap-1">
					<SkeletonBox className="size-[34px] rounded-tag" />
					<SkeletonBox className="size-[34px] rounded-tag" />
				</div>
			</>
		);
	}

	return (
		<>
			<div
				aria-hidden
				className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
				data-condensed="false"
				data-layout-role="dashboard-rail-skeleton"
			>
				<div className="flex h-[34px] items-center gap-2 px-2">
					<SkeletonBox className="size-5 rounded-tag" />
					<SkeletonLine className="w-28" />
				</div>
				<SkeletonBox className="h-[34px] w-full rounded-tag" />
				<DashboardRailNavSkeleton condensed={false} />
			</div>
			<div aria-hidden className="mt-auto flex flex-col gap-1 px-1">
				<div className="flex h-[34px] items-center gap-2 px-2">
					<SkeletonBox className="size-4 rounded-tag" />
					<SkeletonLine className="w-16" />
				</div>
				<div className="flex h-[34px] items-center gap-2 px-2">
					<SkeletonBox className="size-5 rounded-pill" />
					<SkeletonLine className="w-24" />
				</div>
			</div>
		</>
	);
}
