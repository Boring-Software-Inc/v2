import type {
	RedactionPolicy,
	ResponseConfig,
	Verdict,
} from "@tripwire/contracts";
import { redactionLevelFor, wantsCheck } from "@tripwire/contracts";
import { memo, useLayoutEffect, useMemo } from "react";
import { CheckStateMock } from "#/components/responses/check-state-mock";
import { useDrafts } from "#/components/responses/draft-store";
import { GithubCommentMock } from "#/components/responses/github-comment-mock";
import { usePreviewLink } from "#/components/responses/preview-link";
import {
	previewBody,
	SAMPLE_REASONS,
	withDrafts,
} from "#/components/responses/responses-model";
import { RunPageMock } from "#/components/responses/run-page-mock";
import { useChangeCount } from "#/hooks/use-change-count";

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
	const commentLevel = redactionLevelFor(policy, "comment");
	const checkLevel = redactionLevelFor(policy, "check");
	const runPageLevel = redactionLevelFor(policy, "run-page");
	const commentChanges = useChangeCount(`${commentLevel}:${policy.showHelp}`);
	const checkChanges = useChangeCount(checkLevel);
	const link = usePreviewLink();
	useLayoutEffect(() => {
		link.refresh();
	});

	return (
		<section
			aria-label="Preview"
			className="flex flex-col gap-6"
			data-preview-root=""
			ref={link.attach}
		>
			<div
				className="relative rounded-shell"
				data-redact-wipe={commentChanges > 0 ? "" : undefined}
				data-region="comment"
				key={`comment-${commentChanges}`}
			>
				<GithubCommentMock
					body={body}
					silentNote="Turn on Post a comment to preview one here."
				/>
			</div>
			<div
				className="relative rounded-shell sm:ms-13"
				data-redact-wipe={checkChanges > 0 ? "" : undefined}
				data-region="check"
				key={`check-${checkChanges}`}
			>
				<CheckStateMock
					level={checkLevel}
					posted={checkPosted}
					reasons={verdict === "block" ? SAMPLE_REASONS : []}
					verdict={verdict}
				/>
			</div>
			{showRunPage ? (
				<div className="relative rounded-shell" data-region="run-page">
					<RunPageMock level={runPageLevel} />
				</div>
			) : null}
		</section>
	);
});
