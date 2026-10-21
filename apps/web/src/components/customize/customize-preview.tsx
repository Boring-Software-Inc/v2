import type { ResponseConfig, Verdict } from "@tripwire/contracts";
import { wantsCheck } from "@tripwire/contracts";
import { memo, useLayoutEffect, useMemo } from "react";
import { CheckStateMock } from "#/components/customize/check-state-mock";
import {
	previewBody,
	SAMPLE_REASONS,
	withDrafts,
} from "#/components/customize/customize-model";
import { useDrafts } from "#/components/customize/draft-store";
import { GithubCommentMock } from "#/components/customize/github-comment-mock";
import { usePreviewLink } from "#/components/customize/preview-link";

export interface CustomizePreviewProps {
	config: ResponseConfig;
	verdict: Verdict;
	messageChosen: boolean;
}

export const CustomizePreview = memo(function CustomizePreview({
	config,
	verdict,
	messageChosen,
}: CustomizePreviewProps) {
	const drafts = useDrafts();
	const effective = useMemo(() => withDrafts(config, drafts), [config, drafts]);
	const body = useMemo(
		() => previewBody(effective, verdict, messageChosen),
		[effective, verdict, messageChosen],
	);
	const checkPosted = wantsCheck(effective, verdict);
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
			<div className="relative rounded-shell" data-region="comment">
				<GithubCommentMock
					body={body}
					silentNote="Turn on Post a comment to preview one here."
				/>
			</div>
			<div className="relative rounded-shell sm:ms-13" data-region="check">
				<CheckStateMock
					posted={checkPosted}
					reasons={verdict === "block" ? SAMPLE_REASONS : []}
					verdict={verdict}
				/>
			</div>
		</section>
	);
});
