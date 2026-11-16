import { useParams } from "@tanstack/react-router";
import { Button } from "@tripwire/ui/button";
import {
	Icon,
	type IconGlyph,
	NoAccess,
	Package,
	Rules,
	Success,
	TrendDown,
	TrendUp,
	Warning,
} from "@tripwire/ui/icon";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemMeta,
	ItemTitle,
} from "@tripwire/ui/item";
import { StatusMark, type StatusValue } from "@tripwire/ui/status";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	AnalyticsEventFilters,
	EVENT_FIELDS,
	type EventFilters,
	type EventSort,
	matchEvent,
} from "#/components/analytics/analytics-event-filters";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { EntityCard } from "#/components/common/entity-card";
import { useFilteredRows } from "#/components/common/filter-bar";
import { ItemRouterLink } from "#/components/common/router-links";
import { ScrollList } from "#/components/common/scroll-list";
import { MascotArt } from "#/components/mascot/mascot-art";
import { ZonedTime } from "#/components/timezones/zoned-time";
import type {
	AnalyticsEvent,
	EventImpact,
	EventKind,
} from "#/lib/analytics-events";
import type { DateRange } from "#/lib/date-range";
import { cn } from "#/lib/utils";

const KIND_ICON = {
	spike: TrendUp,
	drop: TrendDown,
	rule: Rules,
	ban: NoAccess,
	deploy: Package,
	resolve: Success,
	report: Warning,
} satisfies Record<EventKind, IconGlyph>;

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
	range,
	onRangeChange,
}: {
	events: AnalyticsEvent[];
	focusedId?: string | null;
	range: DateRange | null;
	onRangeChange: (range: DateRange | null) => void;
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
	const [search, setSearch] = useState("");
	const [filters, setFilters] = useState<EventFilters>({});
	const [sort, setSort] = useState<EventSort>("newest");
	const { rows: matched, counts } = useFilteredRows(ordered, {
		search,
		match: matchEvent,
		fields: EVENT_FIELDS,
		filters,
	});
	const rows =
		sort === "oldest"
			? [...matched].sort((a, b) => a.at.localeCompare(b.at))
			: matched;

	if (ordered.length === 0 && range === null) {
		return (
			<EmptyState
				art={<MascotArt mood="analytics-events-empty" size="compact" />}
				size="sm"
			>
				<EmptyStateHeader>
					<EmptyStateTitle>No events for this metric</EmptyStateTitle>
					<EmptyStateDescription>
						Events appear here when Tripwire checks change requests on this
						repo.
					</EmptyStateDescription>
				</EmptyStateHeader>
				{org && repo ? (
					<EmptyStateContent>
						<Button
							href={`/${org}/${repo}/activity`}
							size="small"
							variant="secondary"
						>
							Open activity
						</Button>
					</EmptyStateContent>
				) : null}
			</EmptyState>
		);
	}

	return (
		<EntityCard
			feedbackName="AnalyticsEvents"
			flush
			title={
				<>
					Recent events{" "}
					<span className="text-text-2 tabular-nums">{events.length}</span>
				</>
			}
		>
			<div className="border-line-faint border-b p-3">
				<AnalyticsEventFilters
					counts={counts}
					events={ordered}
					filters={filters}
					onFiltersChange={setFilters}
					onRangeChange={onRangeChange}
					onSearchChange={setSearch}
					onSortChange={setSort}
					range={range}
					search={search}
					shown={rows.length}
					sort={sort}
				/>
			</div>
			<ScrollList label="Recent events">
				{rows.length === 0 ? (
					<p className="px-3 py-4 type-body-sm text-text-2">
						No events match these filters.
					</p>
				) : (
					<ItemGroup aria-label="Recent events" variant="plain">
						{rows.map((event) => (
							<EventRow
								event={event}
								focused={event.id === focusedId}
								key={event.id}
							/>
						))}
					</ItemGroup>
				)}
			</ScrollList>
		</EntityCard>
	);
}

type KindOutcomeMap = Partial<
	Record<EventKind, { status: StatusValue; label: string }>
>;
const KIND_OUTCOME: KindOutcomeMap = {
	ban: { status: "fail", label: "Blocked" },
	resolve: { status: "ok", label: "Passed" },
	report: { status: "waiting", label: "Human review" },
};

function EventRow({
	event,
	focused,
}: {
	event: AnalyticsEvent;
	focused: boolean;
}) {
	const outcome = KIND_OUTCOME[event.kind];
	const text = (
		<span data-layout-role="analytics-event-label">
			<span>{event.detail}</span>
			<span className="text-text-2">{event.title}</span>
		</span>
	);
	return (
		<Item
			aria-current={focused || undefined}
			selected={focused}
			density="compact"
			data-layout-role="analytics-event-row"
		>
			<ItemMedia variant="icon">
				{outcome ? (
					<span title={outcome.label}>
						<StatusMark label={outcome.label} status={outcome.status} />
					</span>
				) : (
					<Icon icon={KIND_ICON[event.kind]} />
				)}
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					{outcome ? (
						<ItemRouterLink params={{ runId: event.id }} to="/runs/$runId">
							{text}
						</ItemRouterLink>
					) : (
						text
					)}
				</ItemTitle>
				{event.impact ? <ImpactChip impact={event.impact} /> : null}
				<ItemMeta>
					<ZonedTime at={event.at} format="short" />
				</ItemMeta>
			</ItemContent>
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
