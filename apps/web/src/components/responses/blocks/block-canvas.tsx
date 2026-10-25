import { useDroppable } from "@dnd-kit/core";
import type { BlockOutput } from "@tripwire/contracts";
import { Fragment } from "react";
import { BlockContent } from "#/components/responses/blocks/block-content";
import { BlockRow } from "#/components/responses/blocks/block-row";
import { DropLine } from "#/components/responses/blocks/drop-line";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";
import { CANVAS_DROP_ID } from "#/components/responses/blocks/use-block-dnd";

export interface BlockCanvasProps {
	builder: BlockBuilder;
	outputs: BlockOutput[];
	rulesHidden: boolean;
	readOnly: boolean;
	org: string;
}

export function BlockCanvas({
	builder,
	outputs,
	rulesHidden,
	readOnly,
	org,
}: BlockCanvasProps) {
	const { setNodeRef } = useDroppable({ id: CANVAS_DROP_ID });
	const lifted =
		builder.drag?.item.source === "canvas" ? builder.drag.item.id : null;

	return (
		<div
			className="flex min-h-12 flex-col px-2 py-2.5"
			data-region="comment-body"
			ref={setNodeRef}
		>
			{outputs.length === 0 ? (
				<p className="px-2 py-1.5 type-body-sm text-text-2">Empty comment</p>
			) : null}
			<ol aria-label="Comment blocks" className="flex flex-col gap-0.5">
				{outputs.map((output, index) => (
					<Fragment key={output.block.id}>
						{builder.dropLine === index ? <DropLine /> : null}
						<BlockRow
							block={output.block}
							lifted={lifted === output.block.id}
							onSelect={builder.select}
							readOnly={readOnly}
							selected={builder.selectedId === output.block.id}
						>
							<BlockContent
								editing={!readOnly && builder.selectedId === output.block.id}
								onUpdate={builder.update}
								org={org}
								output={output}
								rulesHidden={rulesHidden}
							/>
						</BlockRow>
					</Fragment>
				))}
				{builder.dropLine !== null && builder.dropLine === outputs.length ? (
					<DropLine />
				) : null}
			</ol>
		</div>
	);
}
