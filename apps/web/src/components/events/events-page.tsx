import { useQuery } from "@tanstack/react-query";
import { EventRow } from "#/components/events/event-row";
import { LiveIndicator } from "#/components/events/live-indicator";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { eventsQueryOptions, useEventStream } from "#/lib/events.query";
import { MODERATOR } from "#/lib/site-config";

export function EventsPage() {
	const { data, error, isSuccess } = useQuery(eventsQueryOptions());
	useEventStream();

	return (
		<DashboardLayout counts={{}} moderator={MODERATOR}>
			<div className="overflow-stable mx-auto h-full w-full max-w-3xl px-6 py-8">
				<header className="mb-6 flex items-center justify-between">
					<div>
						<h1 className="font-semibold text-2xl tracking-tight">Events</h1>
						<p className="text-muted-foreground text-sm">
							Every ingested forge event, newest first.
						</p>
					</div>
					<LiveIndicator live={isSuccess} />
				</header>
				{error ? (
					<div className="mb-4 rounded-md bg-red-500/10 px-4 py-3 text-red-600 text-sm dark:text-red-400">
						events query failed: {error.message}
					</div>
				) : null}
				{data && data.items.length === 0 ? (
					<div className="rounded-lg border border-dashed px-6 py-16 text-center text-muted-foreground text-sm">
						no events yet — open a change request on a connected repo and it
						lands here without a refresh.
					</div>
				) : (
					<div className="flex flex-col">
						{data?.items.map((event) => (
							<EventRow event={event} key={event.id} />
						))}
					</div>
				)}
			</div>
		</DashboardLayout>
	);
}

export function EventsPageSkeleton() {
	return (
		<DashboardLayout counts={{}} moderator={MODERATOR}>
			<div className="overflow-stable mx-auto h-full w-full max-w-3xl px-6 py-8">
				<div className="mb-6 h-8 w-40 animate-pulse rounded-md bg-surface-1" />
				<div className="flex flex-col gap-2">
					{Array.from({ length: 8 }, (_, i) => `events-skel-${i}`).map(
						(key) => (
							<div
								className="h-11 animate-pulse rounded-md bg-surface-1"
								key={key}
							/>
						),
					)}
				</div>
			</div>
		</DashboardLayout>
	);
}
