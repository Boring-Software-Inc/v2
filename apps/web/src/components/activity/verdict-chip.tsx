import { cn } from "#/lib/utils";

const VERDICT: Record<string, { label: string; className: string }> = {
	block: {
		label: "blocked",
		className: "bg-red-500/10 text-red-600 dark:text-red-400",
	},
	pass: {
		label: "passed",
		className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	},
	needs_review: {
		label: "sent to review",
		className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	},
};

/** The one verdict language across the feed (constitution: blocked/passed/…). */
export function VerdictChip({ verdict }: { verdict: string | null }) {
	const v = verdict ? VERDICT[verdict] : undefined;
	if (!v) {
		return null;
	}
	return (
		<span
			className={cn(
				"shrink-0 rounded-full px-2 py-0.5 font-medium text-xs",
				v.className,
			)}
		>
			{v.label}
		</span>
	);
}
