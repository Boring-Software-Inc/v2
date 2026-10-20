import type { CommentReason, Verdict } from "@tripwire/contracts";
import { CHECK_NAME, checkSummary } from "@tripwire/contracts";
import { Status, type StatusValue } from "#/components/glaze/ui/status";

const CHECK_STATE: Record<Verdict, { word: string; status: StatusValue }> = {
	pass: { word: "Passing", status: "ok" },
	block: { word: "Failing", status: "fail" },
	needs_review: { word: "Neutral", status: "warn" },
};

export interface CheckStateMockProps {
	verdict: Verdict;
	reasons: CommentReason[];
	posted: boolean;
}

export function CheckStateMock({
	verdict,
	reasons,
	posted,
}: CheckStateMockProps) {
	if (!posted) {
		return (
			<div
				className="flex items-center gap-2 rounded-panel border border-line-faint bg-paper px-3 py-2"
				data-dim=""
			>
				<span className="shrink-0 type-label-sm">{CHECK_NAME}</span>
				<span className="min-w-0 truncate type-body-sm text-text-2">
					No check posts on a pass.
				</span>
			</div>
		);
	}
	const state = CHECK_STATE[verdict];
	return (
		<div
			className="flex items-center gap-2 rounded-panel border border-line-faint bg-paper px-3 py-2"
			data-dim=""
		>
			<span className="shrink-0 type-label-sm">{CHECK_NAME}</span>
			<span className="min-w-0 flex-1 truncate type-body-sm text-text-2">
				{checkSummary(verdict, reasons)}
			</span>
			<Status className="shrink-0" size="sm" status={state.status}>
				{state.word}
			</Status>
		</div>
	);
}
