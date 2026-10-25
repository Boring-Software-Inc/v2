import type {
	CloseGif,
	RedactionPolicy,
	ResponseConfig,
} from "@tripwire/contracts";
import { redactionLevelFor } from "@tripwire/contracts";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { memo, useLayoutEffect, useMemo, useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import { StatusMark } from "#/components/glaze/ui/status";
import { CheckStateMock } from "#/components/responses/check-state-mock";
import { CloseGifPicker } from "#/components/responses/close-gif-picker";
import { CommentEditor } from "#/components/responses/comment-editor";
import { useDrafts } from "#/components/responses/draft-store";
import { GithubCommentMock } from "#/components/responses/github-comment-mock";
import { usePreviewLink } from "#/components/responses/preview-link";
import {
	BLUR_SWAP,
	PREVIEW_TRANSITION,
} from "#/components/responses/preview-motion";
import {
	customTextKey,
	type DraftKey,
	type OutcomeMeta,
	previewCheck,
	previewPlan,
	readDraftKey,
	withDrafts,
} from "#/components/responses/responses-model";
import { RunPageMock } from "#/components/responses/run-page-mock";
import { useChangedAlone } from "#/hooks/use-changed-alone";

const INSTANT = { duration: 0 };

export interface ResponsesPreviewProps {
	config: ResponseConfig;
	outcome: OutcomeMeta;
	policy: RedactionPolicy;
	showRunPage: boolean;
	canEdit: boolean;
	org: string;
	onSaveText: (key: DraftKey, text: string) => void;
	onGifChange: (gif: CloseGif | null) => void;
}

function defaultFirstLine(
	config: ResponseConfig,
	outcome: OutcomeMeta,
	policy: RedactionPolicy,
): string {
	const plain = {
		...config,
		[outcome.override]: { ...config[outcome.override], customText: "" },
	};
	const body = previewPlan(plain, outcome, policy).commentBody ?? "";
	return body.split("\n\n")[0]?.replace(/\*\*/g, "") ?? "";
}

export const ResponsesPreview = memo(function ResponsesPreview({
	config,
	outcome,
	policy,
	showRunPage,
	canEdit,
	org,
	onSaveText,
	onGifChange,
}: ResponsesPreviewProps) {
	const drafts = useDrafts();
	const effective = useMemo(() => withDrafts(config, drafts), [config, drafts]);
	const plan = useMemo(
		() => previewPlan(effective, outcome, policy),
		[effective, outcome, policy],
	);
	const check = useMemo(
		() => previewCheck(effective, outcome, policy),
		[effective, outcome, policy],
	);
	const comment = plan.comment === "upsert" ? plan.commentBody : null;
	const runPageLevel = redactionLevelFor(policy, "run-page");
	const typing = useChangedAlone(drafts, config);
	const link = usePreviewLink();
	useLayoutEffect(() => {
		link.refresh();
	});

	const textKey = customTextKey(outcome);
	const [editing, setEditing] = useState(false);
	const editable = canEdit && textKey !== null && comment !== null;
	const isClose = outcome.value === "close";
	const gif = config.closeComment.gif;

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
				<AnimatePresence initial={false}>
					{plan.review ? (
						<motion.div
							className="relative rounded-shell"
							key="review"
							{...BLUR_SWAP}
						>
							<GithubCommentMock action="review" body={plan.review} />
						</motion.div>
					) : null}
				</AnimatePresence>
				{comment !== null || plan.review === null ? (
					<div className="flex flex-col gap-3">
						<div className="relative rounded-shell" data-region="comment">
							<GithubCommentMock
								body={comment}
								edited={outcome.edited}
								editor={
									editing && editable && textKey ? (
										<CommentEditor
											initial={readDraftKey(config, textKey)}
											onCancel={() => setEditing(false)}
											onSave={(text) => {
												onSaveText(textKey, text);
												setEditing(false);
											}}
											placeholder={defaultFirstLine(config, outcome, policy)}
										/>
									) : undefined
								}
								headerAction={
									editable && !editing ? (
										<Button
											onClick={() => setEditing(true)}
											size="sm"
											variant="ghost"
										>
											Edit
										</Button>
									) : undefined
								}
								silentNote="Turn on Post a comment to preview one here."
							/>
						</div>
						{isClose && comment !== null ? (
							<div
								className="flex flex-wrap items-center gap-2 sm:ms-13"
								data-region="gif-controls"
							>
								<CloseGifPicker
									disabled={!canEdit}
									gif={gif}
									onPick={onGifChange}
									org={org}
								/>
								{gif ? (
									<Button
										disabled={!canEdit}
										onClick={() => onGifChange(null)}
										size="sm"
										variant="ghost"
									>
										Remove GIF
									</Button>
								) : null}
							</div>
						) : null}
					</div>
				) : null}
				<div className="relative rounded-shell sm:ms-13" data-region="check">
					<CheckStateMock
						posted={check.posted}
						summary={check.summary}
						verdict={check.verdict}
					/>
				</div>
				{isClose ? (
					<p
						className="flex items-center gap-2 type-body-sm text-text-2 sm:ms-13"
						data-dim=""
					>
						<span className="text-fail-text">
							<StatusMark label="Closed" status="fail" />
						</span>
						<span>
							<span className="font-semibold text-text-1">tripwire</span> closed
							this change request
						</span>
					</p>
				) : null}
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
