import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { BlockOutput, ResponseBlock } from "@tripwire/contracts";
import { Card, CardContent } from "@tripwire/ui/card";
import { DragHandle, Icon } from "@tripwire/ui/icon";
import { useReducedMotion } from "motion/react";
import {
	type CSSProperties,
	Fragment,
	type PointerEventHandler,
	type ReactNode,
} from "react";
import { SortableBlockItem } from "#/components/layouts/sortable-block-item";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";
import { DropLine } from "#/components/responses/blocks/drop-line";
import { EditorBlockSummary } from "#/components/responses/blocks/editor-block-summary";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";
import type { BlockDragData } from "#/components/responses/blocks/use-block-dnd";
import { BLOCK_LIST_DROP_ID } from "#/components/responses/blocks/use-block-dnd";
import { cn } from "#/lib/utils";

const LOCAL_APPEARANCE = {
	row: "group/block relative min-h-14 rounded-tag px-0 py-0 transition-colors duration-(--dur-state) motion-reduce:transition-none",
	rowHover: "hover:not-data-selected:bg-hover-row",
	rowDragging: "z-(--z-raised) opacity-25",
	button:
		"flex min-h-14 w-full items-center gap-3 rounded-tag py-2 pe-3 ps-7 text-start transition-colors duration-(--dur-state) focus-visible:focus-ring-inset",
	buttonDraggable: "cursor-grab active:cursor-grabbing",
	node86_1: "min-w-0 flex-1",
	node91_2:
		"absolute start-1 top-1/2 z-(--z-raised) grid size-6 -translate-y-1/2 cursor-grab place-items-center rounded-tag text-text-3 transition-colors duration-(--dur-state) hover:text-text-1 focus-visible:focus-sm",
	node122_3: "flex flex-col gap-1 p-1",
} as const;

export interface EditorBlockListProps {
	builder: BlockBuilder;
	outputs: BlockOutput[];
	readOnly: boolean;
}

interface EditorBlockRowProps {
	block: ResponseBlock;
	readOnly: boolean;
	selected: boolean;
	onSelect: () => void;
	children: ReactNode;
}

function EditorBlockRow({
	block,
	readOnly,
	selected,
	onSelect,
	children,
}: EditorBlockRowProps) {
	const meta = BLOCK_META[block.type];
	const reduceMotion = useReducedMotion();
	const data: BlockDragData = {
		item: { source: "canvas", id: block.id },
		label: meta.label,
	};
	const sortable = useSortable({ id: block.id, data, disabled: readOnly });
	const rowPointerDown = sortable.listeners?.onPointerDown as
		| PointerEventHandler<HTMLButtonElement>
		| undefined;
	const transform = sortable.transform;
	const style: CSSProperties = {
		transform: transform
			? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
			: undefined,
		transition: reduceMotion ? "none" : sortable.transition,
	};

	return (
		<SortableBlockItem
			className={cn(
				LOCAL_APPEARANCE.row,
				!readOnly && LOCAL_APPEARANCE.rowHover,
				sortable.isDragging && LOCAL_APPEARANCE.rowDragging,
			)}
			data-selected={selected ? "" : undefined}
			motionStyle={style}
			ref={sortable.setNodeRef}
		>
			<button
				aria-controls={selected ? "response-block-settings" : undefined}
				aria-pressed={selected}
				className={cn(
					LOCAL_APPEARANCE.button,
					!readOnly && LOCAL_APPEARANCE.buttonDraggable,
				)}
				onClick={onSelect}
				onPointerDown={readOnly ? undefined : rowPointerDown}
				type="button"
			>
				<span className={LOCAL_APPEARANCE.node86_1}>{children}</span>
			</button>
			{readOnly ? null : (
				<button
					aria-label={`Move ${meta.label}`}
					className={LOCAL_APPEARANCE.node91_2}
					ref={sortable.setActivatorNodeRef}
					type="button"
					{...sortable.attributes}
					{...sortable.listeners}
				>
					<Icon icon={DragHandle} size={14} />
				</button>
			)}
		</SortableBlockItem>
	);
}

export function EditorBlockList({
	builder,
	outputs,
	readOnly,
}: EditorBlockListProps) {
	const { setNodeRef } = useDroppable({
		id: BLOCK_LIST_DROP_ID,
		disabled: readOnly,
	});
	const adding = builder.drag?.item.source === "palette";
	const items = outputs.map((output) => output.block.id);

	return (
		<Card>
			<SortableContext items={items} strategy={verticalListSortingStrategy}>
				<CardContent flush>
					<ol
						aria-label="Response blocks"
						className={LOCAL_APPEARANCE.node122_3}
						ref={setNodeRef}
					>
						{outputs.map((output, index) => (
							<Fragment key={output.block.id}>
								{adding && builder.dropLine === index ? <DropLine /> : null}
								<EditorBlockRow
									block={output.block}
									onSelect={() => builder.focus(output.block.id)}
									readOnly={readOnly}
									selected={builder.selectedId === output.block.id}
								>
									<EditorBlockSummary type={output.block.type} />
								</EditorBlockRow>
							</Fragment>
						))}
						{adding && builder.dropLine === outputs.length ? (
							<DropLine />
						) : null}
					</ol>
				</CardContent>
			</SortableContext>
		</Card>
	);
}
