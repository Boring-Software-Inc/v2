import type { CommentReason, Verdict } from "@tripwire/contracts";
import { CHECK_NAME, checkSummary } from "@tripwire/contracts";
import { cn } from "#/lib/utils";

/**
 * The pull request check row for a verdict — the gate half of the preview's
 * "one pull request moment". Name and summary are the REAL production strings
 * (moved to contracts with the render layer); the state dot follows the house
 * verdict palette. Always rendered: a silent comment never disables the check,
 * and on the one verdict where it can go silent (a pass set to silent) the row
 * says so instead of disappearing.
 */

const CHECK_STATE: Record<
	Verdict,
	{ word: string; dot: string; text: string }
> = {
	pass: {
		word: "passing",
		dot: "bg-emerald-500",
		text: "text-emerald-600 dark:text-emerald-400",
	},
	block: {
		word: "failing",
		dot: "bg-red-500",
		text: "text-red-600 dark:text-red-400",
	},
	needs_review: {
		word: "neutral",
		dot: "bg-amber-500",
		text: "text-amber-600 dark:text-amber-400",
	},
};

export interface CheckStateMockProps {
	verdict: Verdict;
	reasons: CommentReason[];
	/** False only for a pass set to silent — the one state with no check. */
	posted: boolean;
}

export function CheckStateMock({
	verdict,
	reasons,
	posted,
}: CheckStateMockProps) {
	if (!posted) {
		return (
			<div className="flex items-center gap-2.5 rounded-xl bg-surface-1 px-3.5 py-2.5">
				<span className="size-2 shrink-0 rounded-full bg-muted-foreground/30" />
				<span className="font-medium text-xs">{CHECK_NAME}</span>
				<span className="min-w-0 truncate text-muted-foreground text-xs">
					no check posts on a pass.
				</span>
			</div>
		);
	}
	const state = CHECK_STATE[verdict];
	return (
		<div className="flex items-center gap-2.5 rounded-xl bg-surface-1 px-3.5 py-2.5">
			<span className={cn("size-2 shrink-0 rounded-full", state.dot)} />
			<span className="font-medium text-xs">{CHECK_NAME}</span>
			<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
				{checkSummary(verdict, reasons)}
			</span>
			<span className={cn("shrink-0 font-medium text-xs", state.text)}>
				{state.word}
			</span>
		</div>
	);
}
