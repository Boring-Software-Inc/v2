import type { BlockOutput } from "@tripwire/contracts";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";
import { CollapsedBlockRow } from "#/components/responses/blocks/collapsed-block-row";
import { CommentMarkdown } from "#/components/responses/github-comment-mock";
import { Hide } from "#/design-system/icon";

export interface BlockContentProps {
	output: BlockOutput;
}

export function BlockContent({ output }: BlockContentProps) {
	const { block, body } = output;
	const meta = BLOCK_META[block.type];
	if (body === null) {
		return (
			<CollapsedBlockRow
				icon={Hide}
				label={meta.label}
				note="Hidden from outsiders"
			/>
		);
	}
	if (body === "") {
		return <CollapsedBlockRow icon={meta.icon} label={meta.label} />;
	}
	return <CommentMarkdown body={body} />;
}
