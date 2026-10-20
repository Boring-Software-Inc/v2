import type { Verdict } from "@tripwire/contracts";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";

const VERDICTS: { value: Verdict; label: string }[] = [
	{ value: "pass", label: "Passed" },
	{ value: "block", label: "Blocked" },
	{ value: "needs_review", label: "Review" },
];

export interface VerdictToggleProps {
	value: Verdict;
	onChange: (verdict: Verdict) => void;
}

export function VerdictToggle({ value, onChange }: VerdictToggleProps) {
	return (
		<SegmentedControl
			aria-label="Previewed verdict"
			onValueChange={(next) => onChange(next as Verdict)}
			size="sm"
			value={value}
		>
			{VERDICTS.map((verdict) => (
				<SegmentedControlItem key={verdict.value} value={verdict.value}>
					{verdict.label}
				</SegmentedControlItem>
			))}
		</SegmentedControl>
	);
}
