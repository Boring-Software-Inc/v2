import type { Verdict } from "@tripwire/contracts";
import { cn } from "#/lib/utils";

/** Same palette + §12 words as the activity feed's VerdictChip, made pressable. */
const VERDICTS: { value: Verdict; label: string; className: string }[] = [
	{
		value: "pass",
		label: "passed",
		className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	},
	{
		value: "block",
		label: "blocked",
		className: "bg-red-500/10 text-red-600 dark:text-red-400",
	},
	{
		value: "needs_review",
		label: "review",
		className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	},
];

export interface VerdictToggleProps {
	value: Verdict;
	onChange: (verdict: Verdict) => void;
}

/** The preview's direct verdict switcher — flip a chip, the whole moment flips. */
export function VerdictToggle({ value, onChange }: VerdictToggleProps) {
	return (
		<fieldset aria-label="previewed verdict" className="flex gap-1.5">
			{VERDICTS.map((verdict) => (
				<button
					aria-pressed={value === verdict.value}
					className={cn(
						"inline-flex w-[72px] items-center justify-center rounded-full py-1 font-medium text-xs transition-colors",
						value === verdict.value
							? verdict.className
							: "bg-surface-1 text-muted-foreground hover:text-foreground",
					)}
					key={verdict.value}
					onClick={() => onChange(verdict.value)}
					type="button"
				>
					{verdict.label}
				</button>
			))}
		</fieldset>
	);
}
