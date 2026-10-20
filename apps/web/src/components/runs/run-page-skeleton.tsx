import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "#/components/glaze/ui/card";
import { Skeleton, SkeletonText } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { currentUserQueryOptions } from "#/lib/auth.query";

const STEP_SLOTS = [
	{ key: "a", line: "w-40" },
	{ key: "b", line: "w-56" },
	{ key: "c", line: "w-32" },
	{ key: "d", line: "w-48" },
	{ key: "e", line: "w-36" },
	{ key: "f", line: "w-52" },
];

function RunSkeletonBody() {
	return (
		<div aria-hidden className="px-4 py-6 md:px-8 md:py-10">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
				<header className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-3">
						<SkeletonText className="w-16" type="heading" />
						<div className="flex gap-1.5">
							<Skeleton className="h-(--control-sm) w-20 rounded-pill" />
							<Skeleton className="h-(--control-sm) w-24 rounded-pill" />
						</div>
					</div>
					<SkeletonText className="w-20" type="label" />
					<SkeletonText className="w-64" type="body-sm" />
				</header>
				<Card>
					<CardHeader>
						<SkeletonText className="w-12" type="label" />
					</CardHeader>
					<CardContent flush>
						{STEP_SLOTS.map((slot) => (
							<div
								className="rule-row flex items-center gap-3 px-3 py-2.5"
								key={slot.key}
							>
								<span className="flex min-w-0 flex-1 items-center">
									<SkeletonText className={slot.line} type="label" />
								</span>
								<SkeletonText className="w-14 shrink-0" type="label-sm" />
							</div>
						))}
					</CardContent>
				</Card>
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
