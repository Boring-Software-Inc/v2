import type { Verdict } from "@tripwire/contracts";
import { CHECK_NAME } from "@tripwire/contracts";
import { AnimatePresence, motion } from "motion/react";
import { BLUR_SWAP } from "#/components/responses/preview-motion";
import { PreviewObject } from "#/components/responses/preview-object";
import { StatusMark, type StatusValue } from "#/design-system/ui/status";

const CHECK_STATE = {
	pass: { word: "Passing", status: "ok", tone: "text-ok-text" },
	block: { word: "Failing", status: "fail", tone: "text-fail-text" },
	changes_required: {
		word: "Changes needed",
		status: "fail",
		tone: "text-fail-text",
	},
	close: { word: "Closed", status: "fail", tone: "text-fail-text" },
	needs_review: { word: "In progress", status: "warn", tone: "text-warn-text" },
} satisfies Record<
	Verdict,
	{ word: string; status: StatusValue; tone: string }
>;

export interface CheckStateMockProps {
	verdict: Verdict;
	summary: string;
	posted: boolean;
}

export function CheckStateMock({
	verdict,
	summary: postedSummary,
	posted,
}: CheckStateMockProps) {
	const state = posted ? CHECK_STATE[verdict] : null;
	const summary = state
		? postedSummary
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
