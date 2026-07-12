export type RuleSort = "active" | "az";

/**
 * Rules-page sort. FP-rate sort is omitted while the stat is empty (§6 loop),
 * and the mockup's matcher-kind chips (blocklist/heuristic/regex) are omitted
 * because RULE_CATALOG carries no kind metadata — no faked filters.
 */
export function RuleFilters({
	sort,
	onSortChange,
}: {
	sort: RuleSort;
	onSortChange: (sort: RuleSort) => void;
}) {
	return (
		<label className="flex items-center gap-2 text-muted-foreground text-xs">
			sort
			<select
				className="rounded-md border bg-card px-2 py-1 text-foreground text-xs"
				onChange={(e) => onSortChange(e.target.value as RuleSort)}
				value={sort}
			>
				<option value="active">most active</option>
				<option value="az">A–Z</option>
			</select>
		</label>
	);
}
