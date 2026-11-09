import { useDroppable } from "@dnd-kit/core";
import type { BlockOutput } from "@tripwire/contracts";
import { Fragment } from "react";
import { BlockContent } from "#/components/responses/blocks/block-content";
import { BlockRow } from "#/components/responses/blocks/block-row";
import { DropLine } from "#/components/responses/blocks/drop-line";
import { InsertBlockLine } from "#/components/responses/blocks/insert-block-line";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";
import { CANVAS_DROP_ID } from "#/components/responses/blocks/use-block-dnd";

export interface BlockCanvasProps {
	builder: BlockBuilder;
	outputs: BlockOutput[];
	readOnly: boolean;
}

export function BlockCanvas({ builder, outputs, readOnly }: BlockCanvasProps) {
	const { setNodeRef } = useDroppable({ id: CANVAS_DROP_ID });
	const lifted =
		builder.drag?.item.source === "canvas" ? builder.drag.item.id : null;
	const editing =
		builder.drag !== null || outputs.every((output) => !output.body);

	return (
		<div
			className="flex min-h-12 flex-col px-2 py-2.5"
			data-editing={editing || undefined}
			data-region="comment-body"
			ref={setNodeRef}
		>
			{outputs.length === 0 ? (
				<p className="px-2 py-1.5 type-body-sm text-text-2">Empty comment</p>
			) : null}
			<ol aria-label="Comment blocks" className="flex flex-col">
				{outputs.map((output, index) => (
					<Fragment key={output.block.id}>
						{builder.drag || readOnly || builder.full ? null : (
							<InsertBlockLine index={index} onInsert={builder.browse} />
						)}
						{builder.dropLine === index ? <DropLine /> : null}
						<BlockRow
							block={output.block}
							lifted={lifted === output.block.id}
							onSelect={builder.select}
							placeholder={!output.body}
							readOnly={readOnly}
							selected={builder.selectedId === output.block.id}
						>
							<BlockContent output={output} />
						</BlockRow>
					</Fragment>
				))}
				{builder.drag || readOnly || builder.full ? null : (
					<InsertBlockLine index={outputs.length} onInsert={builder.browse} />
				)}
				{builder.dropLine !== null && builder.dropLine === outputs.length ? (
					<DropLine />
				) : null}
			</ol>
		</div>
	);
}
