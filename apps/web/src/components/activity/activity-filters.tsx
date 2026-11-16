import { getRouteApi } from "@tanstack/react-router";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { DateRangeFilter } from "#/components/common/date-range-filter";
import { FilterBar } from "#/components/common/filter-bar";
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
			<div
				className="max-w-full overflow-x-auto"
				onFocusCapture={(event) => {
					const scroller = event.currentTarget;
					const scrollBounds = scroller.getBoundingClientRect();
					const optionBounds = event.target.getBoundingClientRect();
					const left = optionBounds.left - scrollBounds.left;
					const right = optionBounds.right - scrollBounds.right;
					const offset = left < 0 ? left : Math.max(0, right);
					if (offset !== 0)
						scroller.scrollBy({ left: offset, behavior: "instant" });
				}}
			>
				<div className="flex w-max items-center pointer-coarse:min-h-11">
					<SegmentedControl
						ariaLabel="Filter by verdict"
						size="small"
						options={ACTIVITY_VERDICTS.filter(
							(value) => !range || value !== "no-run",
						).map((value) => ({
							label: ACTIVITY_VERDICT_LABELS[value],
							value,
						}))}
						value={verdict}
						onValueChange={(value) => {
							if (!value) return;
							const next = pickValue(ACTIVITY_VERDICTS, value);
							if (next)
								void navigate({
									search: (previous) => ({ ...previous, verdict: next }),
									resetScroll: false,
								});
						}}
					/>
				</div>
			</div>
			<DateRangeFilter onValueChange={setRange} value={range} />
		</FilterBar>
	);
}
