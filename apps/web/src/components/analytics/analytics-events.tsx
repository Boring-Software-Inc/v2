import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { MetaRow } from "#/components/common/meta-row";
import {
	type GlazeIcon,
	Icon,
	NoAccess,
	Package,
	Rules,
	Success,
	TrendDown,
	TrendUp,
	Warning,
} from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemMeta,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { MascotArt } from "#/components/mascot/mascot-art";
import type {
	AnalyticsEvent,
	EventImpact,
	EventKind,
} from "#/lib/analytics-events";
import { formatRelativeTime } from "#/lib/format-relative-time";
import { cn } from "#/lib/glaze/utils";

const KIND_ICON = {
	spike: TrendUp,
	drop: TrendDown,
	rule: Rules,
	ban: NoAccess,
	deploy: Package,
	resolve: Success,
	report: Warning,
} satisfies Record<EventKind, GlazeIcon>;

function withFocusedOnTop(ids: string[], focusedId?: string | null): string[] {
	if (!focusedId) return ids;
	const i = ids.indexOf(focusedId);
	if (i <= 0) return ids;
	const next = [...ids];
	[next[0], next[i]] = [next[i], next[0]];
	return next;
}

export function AnalyticsEvents({
	events,
	focusedId,
}: {
	events: AnalyticsEvent[];
	focusedId?: string | null;
}) {
	const { org, repo } = useParams({ strict: false });
	const [order, setOrder] = useState<string[]>(() =>
		withFocusedOnTop(
			events.map((e) => e.id),
			focusedId,
		),
	);
	const eventsRef = useRef(events);

	useEffect(() => {
		if (eventsRef.current !== events) {
			eventsRef.current = events;
			setOrder(
				withFocusedOnTop(
					events.map((e) => e.id),
					focusedId,
				),
			);
		}
	}, [events, focusedId]);

	useEffect(() => {
		setOrder((prev) => withFocusedOnTop(prev, focusedId));
	}, [focusedId]);

	const byId = useMemo(
		() => new Map(events.map((e) => [e.id, e] as const)),
		[events],
	);
	const ordered = order
		.map((id) => byId.get(id))
		.filter((e): e is AnalyticsEvent => Boolean(e));

	return (
		<section
			aria-labelledby="analytics-activity"
			className="flex flex-col gap-2"
		>
			<div className="flex items-center gap-2">
				<h2 className="type-heading-sm" id="analytics-activity">
					Recent events
				</h2>
				<Badge count={events.length} />
			</div>

			{ordered.length === 0 ? (
				<Empty
					art={<MascotArt mood="analytics-events-empty" size="compact" />}
					size="sm"
				>
					<EmptyHeader>
						<EmptyTitle>No events for this metric</EmptyTitle>
						<EmptyDescription>
							Events appear here when Tripwire checks change requests on this
							repo.
						</EmptyDescription>
					</EmptyHeader>
					{org && repo ? (
						<EmptyContent>
							<Button
								nativeButton={false}
								render={
									<Link params={{ org, repo }} to="/$org/$repo/activity" />
								}
								size="sm"
								variant="secondary"
							>
								Open activity
							</Button>
						</EmptyContent>
					) : null}
				</Empty>
			) : (
				<ItemGroup aria-label="Recent events">
					{ordered.map((event) => (
						<EventRow
							event={event}
							focused={event.id === focusedId}
							key={event.id}
						/>
					))}
				</ItemGroup>
			)}
		</section>
	);
}

function EventRow({
	event,
	focused,
}: {
	event: AnalyticsEvent;
	focused: boolean;
}) {
	return (
		<Item
			aria-current={focused || undefined}
			className="py-2"
			selected={focused}
		>
			<ItemMedia variant="icon">
				<Icon icon={KIND_ICON[event.kind]} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{event.title}</ItemTitle>
				<ItemDescription>
					<MetaRow>
						<span>{event.detail}</span>
						<span>{formatRelativeTime(event.at)}</span>
					</MetaRow>
				</ItemDescription>
			</ItemContent>
			{event.impact ? (
				<ItemMeta>
					<ImpactChip impact={event.impact} />
				</ItemMeta>
			) : null}
		</Item>
	);
}

function ImpactChip({ impact }: { impact: EventImpact }) {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 type-label-sm tabular-nums",
				impact.tone === "down"
					? "text-ok-text"
					: impact.tone === "up"
						? "text-warn-text"
						: "text-text-2",
			)}
		>
			{impact.tone === "up" ? (
				<Icon icon={TrendUp} size={12} />
			) : impact.tone === "down" ? (
				<Icon icon={TrendDown} size={12} />
			) : null}
			{impact.label}
		</span>
	);
}
