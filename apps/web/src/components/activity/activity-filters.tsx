import { getRouteApi } from "@tanstack/react-router";
import { DateRangeFilter } from "#/components/common/date-range-filter";
import { FilterBar } from "#/components/glaze/ui/filter-bar";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { type DateRange, isoDay } from "#/lib/date-range";
import { pickValue } from "#/lib/pick-value";
import { ACTIVITY_VERDICT_LABELS, ACTIVITY_VERDICTS } from "#/lib/repo-search";

const routeApi = getRouteApi("/$org/$repo/activity");

export function ActivityFilters() {
	const { from, to, verdict } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();
	const range =
		from && to
			? { from: isoDay(new Date(from)), to: isoDay(new Date(to)) }
			: null;
	const setRange = (next: DateRange | null) =>
		void navigate({
			search: (previous) => ({
				...previous,
				verdict:
					next && previous.verdict === "no-run" ? "all" : previous.verdict,
				from: next ? `${next.from}T00:00:00.000Z` : undefined,
				to: next ? `${next.to}T23:59:59.999Z` : undefined,
			}),
			resetScroll: false,
		});
	return (
		<FilterBar aria-label="Activity filters">
			<div className="flex max-w-full items-center overflow-x-auto pointer-coarse:min-h-11">
				<SegmentedControl
					aria-label="Filter by verdict"
					className="w-max max-w-none"
					size="sm"
					value={verdict}
					onValueChange={(value) => {
						const next = pickValue(ACTIVITY_VERDICTS, value);
						if (next)
							void navigate({
								search: (previous) => ({ ...previous, verdict: next }),
								resetScroll: false,
							});
					}}
				>
					{ACTIVITY_VERDICTS.filter(
						(value) => !range || value !== "no-run",
					).map((value) => (
						<SegmentedControlItem key={value} value={value}>
							{ACTIVITY_VERDICT_LABELS[value]}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
			</div>
			<DateRangeFilter onValueChange={setRange} value={range} />
		</FilterBar>
	);
}
