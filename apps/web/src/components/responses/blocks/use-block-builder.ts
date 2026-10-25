import type { ResponseBlock, ResponseBlockType } from "@tripwire/contracts";
import { useReducer } from "react";
import { newBlock } from "#/components/responses/blocks/block-catalog";
import {
	type BuilderAction,
	type DragItem,
	dropLineIndex,
	IDLE_UI,
	isFull,
	type PreviewView,
	reduceBuilder,
	reduceBuilderUi,
} from "#/lib/block-builder";

function blockId(): string {
	return crypto.randomUUID();
}

export function useBlockBuilder(
	blocks: ResponseBlock[],
	onChange: (next: ResponseBlock[]) => void,
) {
	const [ui, dispatchUi] = useReducer(reduceBuilderUi, IDLE_UI);

	const dispatch = (action: BuilderAction) => {
		const next = reduceBuilder({ blocks, ...ui }, action).blocks;
		if (next !== blocks) {
			onChange(next);
		}
		dispatchUi({ blocks, action });
	};

	const dragged = ui.drag?.item.source === "palette" ? ui.drag.item.type : null;

	return {
		blocks,
		selectedId: ui.selectedId,
		selected: blocks.find((block) => block.id === ui.selectedId) ?? null,
		drag: ui.drag,
		dropLine: dropLineIndex({ blocks, ...ui }),
		full: isFull(blocks),
		paletteOpen: ui.paletteOpen,
		view: ui.view,
		add: (type: ResponseBlockType) =>
			dispatch({ type: "add", block: newBlock(type, blockId()) }),
		update: (block: ResponseBlock) => dispatch({ type: "update", block }),
		remove: (id: string) => dispatch({ type: "remove", id }),
		select: (id: string | null) => dispatch({ type: "select", id }),
		browse: () => dispatch({ type: "browse" }),
		showPalette: (open: boolean) => dispatch({ type: "palette", open }),
		setView: (view: Partial<PreviewView>) => dispatch({ type: "view", view }),
		dragStart: (item: DragItem) => dispatch({ type: "drag-start", item }),
		dragOver: (index: number | null) => dispatch({ type: "drag-over", index }),
		dragCancel: () => dispatch({ type: "drag-cancel" }),
		drop: (index: number | null) =>
			dispatch({
				type: "drop",
				block: dragged ? newBlock(dragged, blockId()) : null,
				index,
			}),
	};
}

export type BlockBuilder = ReturnType<typeof useBlockBuilder>;
