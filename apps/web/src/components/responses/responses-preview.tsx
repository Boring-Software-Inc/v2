import type {
	RedactionPolicy,
	ResponseConfig,
	Verdict,
} from "@tripwire/contracts";
import { redactionLevelFor, wantsCheck } from "@tripwire/contracts";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { memo, useLayoutEffect, useMemo } from "react";
import { CheckStateMock } from "#/components/responses/check-state-mock";
import { useDrafts } from "#/components/responses/draft-store";
import { GithubCommentMock } from "#/components/responses/github-comment-mock";
import { usePreviewLink } from "#/components/responses/preview-link";
import {
	BLUR_SWAP,
	PREVIEW_TRANSITION,
} from "#/components/responses/preview-motion";
import {
	previewBody,
	SAMPLE_REASONS,
	withDrafts,
} from "#/components/responses/responses-model";
import { RunPageMock } from "#/components/responses/run-page-mock";
import { useChangedAlone } from "#/hooks/use-changed-alone";

const INSTANT = { duration: 0 };

export interface ResponsesPreviewProps {
	config: ResponseConfig;
	verdict: Verdict;
	messageChosen: boolean;
	policy: RedactionPolicy;
	showRunPage: boolean;
}

export const ResponsesPreview = memo(function ResponsesPreview({
	config,
	verdict,
	messageChosen,
	policy,
	showRunPage,
}: ResponsesPreviewProps) {
	const drafts = useDrafts();
	const effective = useMemo(() => withDrafts(config, drafts), [config, drafts]);
	const body = useMemo(
		() => previewBody(effective, verdict, messageChosen, policy),
		[effective, verdict, messageChosen, policy],
	);
	const checkPosted = wantsCheck(effective, verdict);
	const checkLevel = redactionLevelFor(policy, "check");
	const runPageLevel = redactionLevelFor(policy, "run-page");
	const typing = useChangedAlone(drafts, config);
	const link = usePreviewLink();
	useLayoutEffect(() => {
		link.refresh();
	});

	return (
		<MotionConfig
			reducedMotion="user"
			transition={typing ? INSTANT : PREVIEW_TRANSITION}
		>
			<section
				aria-label="Preview"
				className="flex flex-col gap-6"
				data-preview-root=""
				ref={link.attach}
			>
				<div className="relative rounded-shell" data-region="comment">
					<GithubCommentMock
						body={body}
						silentNote="Turn on Post a comment to preview one here."
					/>
				</div>
				<div className="relative rounded-shell sm:ms-13" data-region="check">
					<CheckStateMock
						level={checkLevel}
						posted={checkPosted}
						reasons={verdict === "block" ? SAMPLE_REASONS : []}
						verdict={verdict}
					/>
				</div>
				<AnimatePresence initial={false}>
					{showRunPage ? (
						<motion.div
							className="relative rounded-shell sm:ms-13"
							data-region="run-page"
							key="run-page"
							{...BLUR_SWAP}
						>
							<RunPageMock level={runPageLevel} />
						</motion.div>
					) : null}
				</AnimatePresence>
			</section>
		</MotionConfig>
	);
});
