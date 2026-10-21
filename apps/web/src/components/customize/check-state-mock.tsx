import type { CommentReason, Verdict } from "@tripwire/contracts";
import { CHECK_NAME, checkSummary } from "@tripwire/contracts";
import { PreviewObject } from "#/components/customize/preview-object";
import { StatusMark, type StatusValue } from "#/components/glaze/ui/status";

const CHECK_STATE: Record<
	Verdict,
	{ word: string; status: StatusValue; tone: string }
> = {
	pass: { word: "Passing", status: "ok", tone: "text-ok-text" },
	block: { word: "Failing", status: "fail", tone: "text-fail-text" },
	needs_review: { word: "Neutral", status: "warn", tone: "text-warn-text" },
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
	const state = posted ? CHECK_STATE[verdict] : null;
	return (
		<div data-dim="">
			<PreviewObject>
				<div className="flex min-h-(--row) items-center gap-2 px-4 py-2">
					{state ? (
						<span className={state.tone}>
							<StatusMark label={state.word} status={state.status} />
						</span>
					) : null}
					<span className="shrink-0 type-label font-semibold text-text-1">
						{CHECK_NAME}
					</span>
					<span className="min-w-0 flex-1 truncate type-body-sm text-text-2">
						{state
							? checkSummary(verdict, reasons)
							: "Tripwire posts no check run on a pass."}
					</span>
					{state ? (
						<span className="shrink-0 type-label-sm text-text-2 underline underline-offset-2">
							Details
						</span>
					) : null}
				</div>
			</PreviewObject>
		</div>
	);
}
