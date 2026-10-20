import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/glaze/ui/select";

export type RuleSort = "active" | "az";

const SORTS: { value: RuleSort; label: string }[] = [
	{ value: "active", label: "Most active" },
	{ value: "az", label: "A to Z" },
];

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
		<Select
			items={SORTS}
			onValueChange={(value) => {
				const next = SORTS.find((s) => s.value === value);
				if (next) {
					onSortChange(next.value);
				}
			}}
			value={sort}
		>
			<SelectTrigger aria-label="Sort rules" className="w-36" size="sm">
				<SelectValue />
			</SelectTrigger>
			<SelectContent size="sm">
				{SORTS.map((s) => (
					<SelectItem key={s.value} value={s.value}>
						{s.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
