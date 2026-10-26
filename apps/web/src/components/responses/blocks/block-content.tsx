import type { BlockOutput, CloseGif, ResponseBlock } from "@tripwire/contracts";
import { Hide } from "#/components/glaze/icon";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";
import { CollapsedBlockRow } from "#/components/responses/blocks/collapsed-block-row";
import { GifBlockPopover } from "#/components/responses/blocks/gif-block-popover";
import { TextBlockEditor } from "#/components/responses/blocks/text-block-editor";
import { CommentMarkdown } from "#/components/responses/github-comment-mock";

export interface BlockContentProps {
	output: BlockOutput;
	editing: boolean;
	rulesHidden: boolean;
	org: string;
	onUpdate: (block: ResponseBlock) => void;
}

export function BlockContent({
	output,
	editing,
	rulesHidden,
	org,
	onUpdate,
}: BlockContentProps) {
	const { block, body } = output;
	const meta = BLOCK_META[block.type];
	if (editing && block.type === "text") {
		return (
			<TextBlockEditor
				block={block}
				onChange={onUpdate}
				rulesHidden={rulesHidden}
			/>
		);
	}
	if (editing && block.type === "gif") {
		const pick = (gif: CloseGif) => onUpdate({ ...block, gif });
		return (
			<div className="flex flex-col items-start gap-2">
				{body ? <CommentMarkdown body={body} /> : null}
				<GifBlockPopover gif={block.gif} onPick={pick} org={org} />
			</div>
		);
	}
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
		return (
			<CollapsedBlockRow
				icon={meta.icon}
				label={meta.label}
				note="Empty in this sample"
			/>
		);
	}
	return <CommentMarkdown body={body} />;
}
