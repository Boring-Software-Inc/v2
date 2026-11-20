import type { BlockOutput } from "@tripwire/contracts";
import { useRef } from "react";
import { BlockContent } from "#/components/responses/blocks/block-content";
import { BlockRow } from "#/components/responses/blocks/block-row";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";

export interface BlockCanvasProps {
	builder: BlockBuilder;
	outputs: BlockOutput[];
	readOnly: boolean;
}

export function BlockCanvas({ builder, outputs, readOnly }: BlockCanvasProps) {
	const canvas = useRef<HTMLDivElement>(null);
	const editing = outputs.every((output) => !output.body);

	return (
		<div
			className="flex min-h-12 flex-col px-2 py-2.5"
			data-editing={editing || undefined}
			data-region="comment-body"
			ref={canvas}
		>
			{outputs.length === 0 ? (
				<p className="px-2 py-1.5 type-body-sm text-text-2">Empty comment</p>
			) : null}
			<ol aria-label="Comment blocks" className="flex flex-col">
				{outputs.map((output, index) => (
					<BlockRow
						block={output.block}
						dimmed={
							builder.selectedId !== null &&
							builder.selectedId !== output.block.id
						}
						key={output.block.id}
						onSelect={(id) => {
							if (id) builder.focus(id);
						}}
						onNavigate={(direction) => {
							const next = outputs[index + direction];
							if (!next) return;
							builder.focus(next.block.id);
							requestAnimationFrame(() => {
								canvas.current
									?.querySelector<HTMLButtonElement>(
										`[data-block-id="${CSS.escape(next.block.id)}"] button[aria-label^="Edit "]`,
									)
									?.focus({ preventScroll: true });
							});
						}}
						placeholder={!output.body}
						readOnly={readOnly}
						selected={builder.selectedId === output.block.id}
					>
						<BlockContent output={output} />
					</BlockRow>
				))}
			</ol>
		</div>
	);
}
