import type { CommentReason, Verdict } from "@tripwire/contracts";
import { CHECK_NAME, checkSummary } from "@tripwire/contracts";
import { AnimatePresence, motion } from "motion/react";
import { StatusMark, type StatusValue } from "#/components/glaze/ui/status";
import { BLUR_SWAP } from "#/components/responses/preview-motion";
import { PreviewObject } from "#/components/responses/preview-object";

const CHECK_STATE: Record<
	Verdict,
	{ word: string; status: StatusValue; tone: string }
> = {
	pass: { word: "Passing", status: "ok", tone: "text-ok-text" },
	block: { word: "Failing", status: "fail", tone: "text-fail-text" },
	changes_required: {
		word: "Failing",
		status: "fail",
		tone: "text-fail-text",
	},
	close: { word: "Failing", status: "fail", tone: "text-fail-text" },
	needs_review: { word: "In progress", status: "warn", tone: "text-warn-text" },
};

export interface CheckStateMockProps {
	verdict: Verdict;
	reasons: CommentReason[];
	posted: boolean;
	level: number;
}

export function CheckStateMock({
	verdict,
	reasons,
	posted,
	level,
}: CheckStateMockProps) {
	const state = posted ? CHECK_STATE[verdict] : null;
	const summary = state
		? checkSummary(verdict, reasons, false, level)
		: "Tripwire posts no check run on a pass.";
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
					<span className="relative min-w-0 flex-1 type-body-sm text-text-2">
						<AnimatePresence initial={false} mode="popLayout">
							<motion.span
								className="block truncate"
								key={summary}
								{...BLUR_SWAP}
							>
								{summary}
							</motion.span>
						</AnimatePresence>
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
