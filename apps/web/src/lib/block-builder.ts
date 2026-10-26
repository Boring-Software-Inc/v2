import type {
	BlockViewer,
	ResponseBlock,
	ResponseBlockType,
} from "@tripwire/contracts";
import { BLOCK_LIST_MAX } from "@tripwire/contracts";

export type DragItem =
	| { source: "palette"; type: ResponseBlockType }
	| { source: "canvas"; id: string };

export interface BlockDrag {
	item: DragItem;
	index: number | null;
}

export type PreviewTab = "check" | "comment" | "review" | "run-page";

export interface PreviewView {
	tab: PreviewTab;
	viewer: BlockViewer;
}

export interface BuilderState {
	blocks: ResponseBlock[];
	selectedId: string | null;
	drag: BlockDrag | null;
	paletteOpen: boolean;
	view: PreviewView;
}

export const OPEN_VIEW: PreviewView = { tab: "comment", viewer: "outsider" };

export type BuilderAction =
	| { type: "add"; block: ResponseBlock; index?: number }
	| { type: "move"; id: string; index: number }
	| { type: "update"; block: ResponseBlock }
	| { type: "remove"; id: string }
	| { type: "select"; id: string | null }
	| { type: "palette"; open: boolean }
	| { type: "browse" }
	| { type: "view"; view: Partial<PreviewView> }
	| { type: "drag-start"; item: DragItem }
	| { type: "drag-over"; index: number | null }
	| { type: "drag-cancel" }
	| { type: "drop"; block: ResponseBlock | null; index: number | null };

export function movedIndex(from: number, index: number): number | null {
	if (index === from || index === from + 1) {
		return null;
	}
	return index > from ? index - 1 : index;
}

function insertAt(
	blocks: ResponseBlock[],
	block: ResponseBlock,
	index: number,
): ResponseBlock[] {
	const at = Math.max(0, Math.min(index, blocks.length));
	return [...blocks.slice(0, at), block, ...blocks.slice(at)];
}

function moveBlock(
	blocks: ResponseBlock[],
	id: string,
	index: number,
): ResponseBlock[] {
	const from = blocks.findIndex((block) => block.id === id);
	const to = from === -1 ? null : movedIndex(from, index);
	const block = blocks[from];
	if (to === null || !block) {
		return blocks;
	}
	const rest = blocks.filter((other) => other.id !== id);
	return insertAt(rest, block, to);
}

export function isFull(blocks: readonly ResponseBlock[]): boolean {
	return blocks.length >= BLOCK_LIST_MAX;
}

export function addIndex(state: BuilderState): number {
	const selected = state.blocks.findIndex(
		(block) => block.id === state.selectedId,
	);
	return selected === -1 ? state.blocks.length : selected + 1;
}

export function reduceBuilder(
	state: BuilderState,
	action: BuilderAction,
): BuilderState {
	switch (action.type) {
		case "add":
			if (isFull(state.blocks)) {
				return state;
			}
			return {
				...state,
				blocks: insertAt(
					state.blocks,
					action.block,
					action.index ?? addIndex(state),
				),
				selectedId: action.block.id,
			};
		case "move":
			return {
				...state,
				blocks: moveBlock(state.blocks, action.id, action.index),
			};
		case "update":
			return {
				...state,
				blocks: state.blocks.map((block) =>
					block.id === action.block.id ? action.block : block,
				),
			};
		case "remove":
			return {
				...state,
				blocks: state.blocks.filter((block) => block.id !== action.id),
				selectedId: state.selectedId === action.id ? null : state.selectedId,
			};
		case "select":
			return { ...state, selectedId: action.id };
		case "palette":
			return {
				...state,
				paletteOpen: action.open,
				selectedId: action.open ? state.selectedId : null,
			};
		case "browse":
			return { ...state, selectedId: null, paletteOpen: true };
		case "view":
			return { ...state, view: { ...state.view, ...action.view } };
		case "drag-start":
			return { ...state, drag: { item: action.item, index: null } };
		case "drag-over":
			return state.drag && state.drag.index !== action.index
				? { ...state, drag: { ...state.drag, index: action.index } }
				: state;
		case "drag-cancel":
			return { ...state, drag: null };
		case "drop": {
			const { drag } = state;
			const { index } = action;
			const settled = { ...state, drag: null };
			if (!drag || index === null) {
				return settled;
			}
			if (drag.item.source === "canvas") {
				return reduceBuilder(settled, {
					type: "move",
					id: drag.item.id,
					index,
				});
			}
			return action.block
				? reduceBuilder(settled, { type: "add", block: action.block, index })
				: settled;
		}
	}
}

export function dropLineIndex(state: BuilderState): number | null {
	const drag = state.drag;
	if (!drag || drag.index === null) {
		return null;
	}
	if (drag.item.source === "palette") {
		return drag.index;
	}
	const { id } = drag.item;
	const from = state.blocks.findIndex((block) => block.id === id);
	return movedIndex(from, drag.index) === null ? null : drag.index;
}

export function verticalStep(
	direction: "up" | "down",
	top: number,
	height: number,
	centers: readonly number[],
): number | null {
	const center = top + height / 2;
	const target =
		direction === "down"
			? Math.min(...centers.filter((other) => other > center))
			: Math.max(...centers.filter((other) => other < center));
	if (!Number.isFinite(target)) {
		return null;
	}
	return target + (direction === "down" ? 1 : -1) - height / 2;
}

export function dropPosition(
	blocks: readonly ResponseBlock[],
	item: DragItem,
	index: number,
): { position: number; total: number } {
	if (item.source === "palette") {
		return { position: index + 1, total: blocks.length + 1 };
	}
	const from = blocks.findIndex((block) => block.id === item.id);
	const to = from === -1 ? index : (movedIndex(from, index) ?? from);
	return { position: to + 1, total: blocks.length };
}

export function dropIndexFor(
	blocks: readonly ResponseBlock[],
	overId: string,
	after: boolean,
): number {
	const index = blocks.findIndex((block) => block.id === overId);
	if (index === -1) {
		return blocks.length;
	}
	return after ? index + 1 : index;
}

export type BuilderUi = Omit<BuilderState, "blocks">;

export const IDLE_UI: BuilderUi = {
	selectedId: null,
	drag: null,
	paletteOpen: true,
	view: OPEN_VIEW,
};

export function reduceBuilderUi(
	ui: BuilderUi,
	{ blocks, action }: { blocks: ResponseBlock[]; action: BuilderAction },
): BuilderUi {
	const { blocks: _, ...next } = reduceBuilder({ blocks, ...ui }, action);
	return next.selectedId === ui.selectedId &&
		next.drag === ui.drag &&
		next.paletteOpen === ui.paletteOpen &&
		next.view === ui.view
		? ui
		: next;
}
