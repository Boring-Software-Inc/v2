import { useQuery } from "@tanstack/react-query";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { currentUserQueryOptions } from "#/lib/auth.query";

const NODE_SLOTS = [
	{ key: "event", title: "w-48", detail: "w-32" },
	{ key: "checks", title: "w-40", detail: null },
	{ key: "outcome", title: "w-36", detail: "w-64" },
];

function RunSkeletonBody() {
	return (
		<div aria-hidden className="px-4 py-6 md:px-8 md:py-10">
			<div className="mx-auto flex w-full max-w-220 flex-col gap-10">
				<header className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-3">
						<SkeletonText className="w-40" type="heading" />
						<div className="flex gap-2">
							<Skeleton className="h-(--control-sm) w-20 rounded-pill" />
							<Skeleton className="h-(--control-sm) w-24 rounded-pill" />
						</div>
					</div>
					<SkeletonText className="w-64" type="body-sm" />
				</header>
				<ol className="flex flex-col">
					{NODE_SLOTS.map((slot, index) => (
						<li className="flex gap-4" key={slot.key}>
							<div className="flex w-6 shrink-0 flex-col items-center">
								<Skeleton className="size-6 rounded-pill" />
								{index < NODE_SLOTS.length - 1 ? (
									<span className="w-px grow bg-line" />
								) : null}
							</div>
							<div className="flex min-w-0 flex-1 flex-col gap-2 pb-8">
								<SkeletonText className={slot.title} type="label" />
								{slot.detail ? (
									<SkeletonText className={slot.detail} type="body-sm" />
								) : (
									<Skeleton className="h-32 w-full max-w-140 rounded-shell" />
								)}
							</div>
						</li>
					))}
				</ol>
			</div>
		</div>
	);
}

export function RunPageSkeleton() {
	const { data: user } = useQuery(currentUserQueryOptions());
	if (user) {
		return (
			<DashboardLayout counts={{}}>
				<RunSkeletonBody />
			</DashboardLayout>
		);
	}
	return (
		<div className="min-h-dvh bg-page">
			<RunSkeletonBody />
		</div>
	);
}
