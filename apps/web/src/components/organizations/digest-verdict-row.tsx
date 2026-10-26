import type { Verdict } from "@tripwire/contracts";
import {
	Blocked,
	FailedMark,
	FollowUp,
	Icon,
	Success,
	Time,
} from "#/components/glaze/icon";
import { Item, ItemContent, ItemTitle } from "#/components/glaze/ui/item";

const VERDICTS = {
	block: { label: "Blocked", icon: FailedMark, color: "text-text-1" },
	changes_required: {
		label: "Changes needed",
		icon: FollowUp,
		color: "text-warn",
	},
	needs_review: { label: "Human review", icon: Time, color: "text-warn" },
	pass: { label: "Passed", icon: Success, color: "text-ok" },
	close: { label: "Closed", icon: Blocked, color: "text-text-1" },
} as const;

interface DigestVerdictRowProps {
	verdict: Verdict;
	count: number;
}

export function DigestVerdictRow({ verdict, count }: DigestVerdictRowProps) {
	const { label, icon, color } = VERDICTS[verdict];
	return (
		<Item className="min-h-11 gap-2 px-0">
			<Icon className={color} icon={icon} />
			<ItemContent>
				<ItemTitle>{label}</ItemTitle>
			</ItemContent>
			<span className="type-body-sm tabular-nums">{count}</span>
		</Item>
	);
}
