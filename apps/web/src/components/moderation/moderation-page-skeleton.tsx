import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Skeleton } from "#/components/ui/skeleton";

export function ModerationPageSkeleton() {
	return (
		<DashboardLayout counts={{}}>
			<div className="px-5 py-6 md:px-8 md:py-10">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
					<Skeleton className="h-8 w-40" />
					<PanelSkeleton />
					<QueueSkeleton />
				</div>
			</div>
		</DashboardLayout>
	);
}

const QUEUE_SLOTS = ["a", "b", "c", "d", "e", "f"];
const CARD_SLOTS = ["review", "blocked", "passed"];

export function PanelSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
			{CARD_SLOTS.map((slot) => (
				<Skeleton className="h-28 rounded-xl" key={slot} />
			))}
		</div>
	);
}

export function QueueSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<Skeleton className="mx-3 h-5 w-40" />
			<div className="flex flex-col gap-1">
				{QUEUE_SLOTS.map((slot) => (
					<Skeleton className="h-14 rounded-lg" key={slot} />
				))}
			</div>
		</div>
	);
}
