import { useQuery } from "@tanstack/react-query";
import { EventRow } from "#/components/events/event-row";
import { LiveIndicator } from "#/components/events/live-indicator";
import { eventsQueryOptions, useEventStream } from "#/lib/events.query";

export function EventsPage() {
	const { data, isSuccess } = useQuery(eventsQueryOptions());
	useEventStream();

	return (
		<div className="mx-auto w-full max-w-3xl px-6 py-8">
			<header className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-2xl tracking-tight">Events</h1>
					<p className="text-muted-foreground text-sm">
						Every ingested forge event, newest first.
					</p>
				</div>
				<LiveIndicator live={isSuccess} />
			</header>
			{data && data.items.length === 0 ? (
				<div className="rounded-lg border border-dashed px-6 py-16 text-center text-muted-foreground text-sm">
					no events yet — open a change request on a connected repo and it lands
					here without a refresh.
				</div>
			) : (
				<div className="flex flex-col">
					{data?.items.map((event) => (
						<EventRow event={event} key={event.id} />
					))}
				</div>
			)}
		</div>
	);
}

export function EventsPageSkeleton() {
	return (
		<div className="mx-auto w-full max-w-3xl px-6 py-8">
			<div className="mb-6 h-8 w-40 animate-pulse rounded-md bg-surface-1" />
			<div className="flex flex-col gap-2">
				{Array.from({ length: 8 }, (_, i) => `events-skel-${i}`).map((key) => (
					<div
						className="h-11 animate-pulse rounded-md bg-surface-1"
						key={key}
					/>
				))}
			</div>
		</div>
	);
}
