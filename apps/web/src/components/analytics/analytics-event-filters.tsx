import { DateRangeFilter } from "#/components/common/date-range-filter";
import {
	type FacetField,
	FilterBar,
	FilterBarClear,
	FilterBarCount,
	FilterBarSearch,
	FilterBarSelect,
} from "#/components/glaze/ui/filter-bar";
import type { AnalyticsEvent } from "#/lib/analytics-events";
import type { DateRange } from "#/lib/date-range";

export const EVENT_FIELDS: FacetField<AnalyticsEvent>[] = [
	{ id: "contributor", value: (event) => event.title },
];

export type EventSort = "newest" | "oldest";

const SORTS: { value: EventSort; label: string }[] = [
	{ value: "newest", label: "Newest" },
	{ value: "oldest", label: "Oldest" },
];

export function matchEvent(event: AnalyticsEvent, query: string): boolean {
	return (
		event.title.toLowerCase().includes(query) ||
		event.detail.toLowerCase().includes(query)
	);
}

export type EventFilters = Record<string, string[]>;

export function AnalyticsEventFilters({
	events,
	search,
	onSearchChange,
	filters,
	onFiltersChange,
	counts,
	shown,
	range,
	onRangeChange,
	sort,
	onSortChange,
}: {
	events: AnalyticsEvent[];
	search: string;
	onSearchChange: (search: string) => void;
	filters: EventFilters;
	onFiltersChange: (filters: EventFilters) => void;
	counts: Record<string, Record<string, number>>;
	shown: number;
	range: DateRange | null;
	onRangeChange: (range: DateRange | null) => void;
	sort: EventSort;
	onSortChange: (sort: EventSort) => void;
}) {
	const contributors = [...new Set(events.map((event) => event.title))].sort();
	const active =
		search.trim().length > 0 ||
		Object.values(filters).some((v) => v.length > 0);
	const set = (id: string, value: string[]) =>
		onFiltersChange({ ...filters, [id]: value });

	return (
		<FilterBar>
			<FilterBarSearch
				aria-label="Search events"
				onValueChange={onSearchChange}
				placeholder="Search"
				value={search}
			/>
			<FilterBarSelect
				label="Contributor"
				multiple
				onValueChange={(value) => set("contributor", value)}
				options={contributors.map((name) => ({
					value: name,
					label: name,
					count: counts.contributor?.[name] ?? 0,
				}))}
				value={filters.contributor ?? []}
			/>
			<DateRangeFilter onValueChange={onRangeChange} value={range} />
			<FilterBarSelect
				label="Sort"
				onValueChange={(value) => {
					const next = SORTS.find((option) => option.value === value);
					if (next) {
						onSortChange(next.value);
					}
				}}
				options={SORTS}
				value={sort}
			/>
			{active ? (
				<>
					<FilterBarCount noun="events" shown={shown} total={events.length} />
					<FilterBarClear
						onClick={() => {
							onSearchChange("");
							onFiltersChange({});
							onRangeChange(null);
						}}
					/>
				</>
			) : null}
		</FilterBar>
	);
}
