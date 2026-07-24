import { cn } from "#/lib/utils";

/** Which slice of the rule list is shown. Derived entirely from existing
 * `RuleConfigView` fields (no taxonomy): `active` = enabled, `workflows` =
 * managed, `custom` = source. */
export type RuleFilter = "all" | "active" | "workflows" | "custom";

const SEGMENTS: { key: RuleFilter; label: string }[] = [
	{ key: "all", label: "all" },
	{ key: "active", label: "active" },
	{ key: "workflows", label: "in workflows" },
	{ key: "custom", label: "custom" },
];

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
		<div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-1 p-0.5 text-xs">
			{shown.map((seg) => {
				const active = filter === seg.key;
				return (
					<button
						aria-pressed={active}
						className={cn(
							"flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors",
							active
								? "bg-background text-foreground shadow-xs"
								: "text-muted-foreground hover:text-foreground",
						)}
						key={seg.key}
						onClick={() => onChange(seg.key)}
						type="button"
					>
						{seg.label}
						<span
							className={cn(
								"tabular-nums",
								active ? "text-muted-foreground" : "text-muted-foreground/60",
							)}
						>
							{counts[seg.key]}
						</span>
					</button>
				);
			})}
		</div>
	);
}
