import type { ResponseConfig, Verdict } from "@tripwire/contracts";
import { wantsCheck } from "@tripwire/contracts";
import { memo, type ReactNode, useLayoutEffect, useMemo } from "react";
import { CheckStateMock } from "#/components/customize/check-state-mock";
import {
	previewBody,
	SAMPLE_REASONS,
	withDrafts,
} from "#/components/customize/customize-model";
import { useDrafts } from "#/components/customize/draft-store";
import { GithubCommentMock } from "#/components/customize/github-comment-mock";
import {
	type PreviewRegion,
	usePreviewLink,
} from "#/components/customize/preview-link";

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
			className="flex flex-col gap-4 rounded-shell bg-shell p-3 md:p-4"
			data-preview-root=""
			ref={link.attach}
		>
			<Surface label="Comment" region="comment">
				<GithubCommentMock
					body={body}
					silentNote="Turn on Post a comment to preview one here."
				/>
			</Surface>
			<Surface label="Check run" region="check">
				<CheckStateMock
					posted={checkPosted}
					reasons={verdict === "block" ? SAMPLE_REASONS : []}
					verdict={verdict}
				/>
			</Surface>
		</section>
	);
});

function Surface({
	label,
	region,
	children,
}: {
	label: string;
	region: PreviewRegion;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<h3 className="type-label-sm text-text-2">{label}</h3>
			<div className="relative rounded-panel" data-region={region}>
				{children}
			</div>
		</div>
	);
}
