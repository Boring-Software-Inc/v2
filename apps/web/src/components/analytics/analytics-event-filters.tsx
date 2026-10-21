import {
	type FacetField,
	FilterBar,
	FilterBarClear,
	FilterBarCount,
	FilterBarSearch,
	FilterBarSelect,
} from "#/components/glaze/ui/filter-bar";
import type { AnalyticsEvent } from "#/lib/analytics-events";

const DAY = 24 * 60 * 60 * 1000;

const AGES = [
	{ value: "day", label: "Last 24 hours" },
	{ value: "week", label: "Last 7 days" },
	{ value: "older", label: "Older" },
];

function ageOf(event: AnalyticsEvent): string {
	const age = Date.now() - new Date(event.at).getTime();
	if (age < DAY) {
		return "day";
	}
	return age < 7 * DAY ? "week" : "older";
}

export const EVENT_FIELDS: FacetField<AnalyticsEvent>[] = [
	{ id: "contributor", value: (event) => event.title },
	{ id: "age", value: ageOf },
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
}: {
	events: AnalyticsEvent[];
	search: string;
	onSearchChange: (search: string) => void;
	filters: EventFilters;
	onFiltersChange: (filters: EventFilters) => void;
	counts: Record<string, Record<string, number>>;
	shown: number;
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
			<FilterBarSelect
				label="When"
				multiple
				onValueChange={(value) => set("age", value)}
				options={AGES.map((age) => ({
					...age,
					count: counts.age?.[age.value] ?? 0,
				}))}
				value={filters.age ?? []}
			/>
			{active ? (
				<>
					<FilterBarCount noun="events" shown={shown} total={events.length} />
					<FilterBarClear
						onClick={() => {
							onSearchChange("");
							onFiltersChange({});
						}}
					/>
				</>
			) : null}
		</FilterBar>
	);
}
