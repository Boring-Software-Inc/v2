import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";

/** Which slice of the rule list is shown. Derived entirely from existing
 * `RuleConfigView` fields (no taxonomy): `active` = enabled, `workflows` =
 * managed, `custom` = source. */
export type RuleFilter = "all" | "active" | "workflows" | "custom";

const SEGMENTS: { key: RuleFilter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "active", label: "Active" },
	{ key: "workflows", label: "In workflows" },
	{ key: "custom", label: "Custom" },
];

const isRuleFilter = (value: string): value is RuleFilter =>
	SEGMENTS.some((seg) => seg.key === value);

/**
 * Segmented filter for the rules grid — jumps straight to active/custom/managed
 * rules instead of scrolling the whole built-in list. "in workflows" hides when
 * nothing is managed; "all"/"active"/"custom" always show (custom is the path to
 * the create empty state). Counts sit inline so emptiness reads at a glance.
 */
export function RuleSegments({
	filter,
	counts,
	onChange,
}: {
	filter: RuleFilter;
	counts: Record<RuleFilter, number>;
	onChange: (filter: RuleFilter) => void;
}) {
	const shown = SEGMENTS.filter(
		(seg) => seg.key !== "workflows" || counts.workflows > 0,
	);
	return (
		<SegmentedControl
			aria-label="Show rules"
			onValueChange={(value) => {
				if (isRuleFilter(value)) {
					onChange(value);
				}
			}}
			size="sm"
			value={filter}
		>
			{shown.map((seg) => (
				<SegmentedControlItem
					count={counts[seg.key]}
					key={seg.key}
					value={seg.key}
				>
					{seg.label}
				</SegmentedControlItem>
			))}
		</SegmentedControl>
	);
}
