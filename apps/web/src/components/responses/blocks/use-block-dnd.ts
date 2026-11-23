import {
	type Active,
	type Announcements,
	type CollisionDetection,
	closestCenter,
	type DragEndEvent,
	type DragMoveEvent,
	type DragStartEvent,
	KeyboardSensor,
	type MeasuringConfiguration,
	MeasuringStrategy,
	type Over,
	PointerSensor,
	pointerWithin,
	rectIntersection,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { ResponseBlock } from "@tripwire/contracts";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";
import { type DragItem, dropIndexFor, dropPosition } from "#/lib/block-builder";

export const BLOCK_LIST_DROP_ID = "response-block-list";

export interface BlockDragData {
	item: DragItem;
	label: string;
}

const blockCollision: CollisionDetection = (args) => {
	const canvas = args.droppableContainers.filter(
		(container) => container.id === BLOCK_LIST_DROP_ID,
	);
	const blocks = args.droppableContainers.filter(
		(container) => container.id !== BLOCK_LIST_DROP_ID,
	);
	const onCanvas = { ...args, droppableContainers: canvas };
	const inside =
		!args.pointerCoordinates ||
		pointerWithin(onCanvas).length > 0 ||
		rectIntersection(onCanvas).length > 0;
	if (!inside) {
		return [];
	}
	if (blocks.length === 0) {
		return canvas.map((container) => ({ id: container.id }));
	}
	return closestCenter({ ...args, droppableContainers: blocks });
};

const MEASURING: MeasuringConfiguration = {
	droppable: { strategy: MeasuringStrategy.BeforeDragging },
};

const KEYBOARD_CODES = {
	start: ["Space"],
	cancel: ["Escape"],
	end: ["Space", "Enter"],
};

const SCREEN_READER_INSTRUCTIONS = {
	draggable:
		"Press space to pick up this block. Use the up and down arrows to move it, space to drop it, or escape to cancel.",
};

function dragData(active: Active): BlockDragData | null {
	const data = active.data.current;
	return data && "item" in data ? (data as BlockDragData) : null;
}

function dropIndex(
	blocks: readonly ResponseBlock[],
	active: Active,
	over: Over | null,
): number | null {
	if (!over) {
		return null;
	}
	if (over.id === BLOCK_LIST_DROP_ID) {
		return blocks.length;
	}
	const item = dragData(active)?.item;
	if (item?.source === "canvas") {
		const from = blocks.findIndex((block) => block.id === item.id);
		const to = blocks.findIndex((block) => block.id === over.id);
		if (from === -1 || to === -1) return null;
		return from < to ? to + 1 : to;
	}
	const rect = active.rect.current.translated;
	const after = rect
		? rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2
		: false;
	return dropIndexFor(blocks, String(over.id), after);
}

function announcements(blocks: readonly ResponseBlock[]): Announcements {
	const label = (active: Active) => dragData(active)?.label ?? "Block";
	const position = (active: Active, over: Over | null) => {
		const item = dragData(active)?.item;
		const index = dropIndex(blocks, active, over);
		if (!item || index === null) {
			return "outside the comment";
		}
		const slot = dropPosition(blocks, item, index);
		return `at position ${slot.position} of ${slot.total}`;
	};
	return {
		onDragStart: ({ active }) => `Picked up ${label(active)}.`,
		onDragOver: ({ active, over }) =>
			`${label(active)} is ${position(active, over)}.`,
		onDragEnd: ({ active, over }) =>
			over
				? `${label(active)} dropped ${position(active, over)}.`
				: `${label(active)} returned to its place.`,
		onDragCancel: ({ active }) => `Moving ${label(active)} was cancelled.`,
	};
}

export function useBlockDnd(builder: BlockBuilder) {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
			keyboardCodes: KEYBOARD_CODES,
		}),
	);
	const track = ({ active, over }: DragMoveEvent) => {
		const item = dragData(active)?.item;
		builder.dragOver(
			item?.source === "palette"
				? dropIndex(builder.blocks, active, over)
				: null,
		);
	};

	return {
		sensors,
		collisionDetection: blockCollision,
		measuring: MEASURING,
		accessibility: {
			announcements: announcements(builder.blocks),
			screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
		},
		onDragStart: ({ active }: DragStartEvent) => {
			const data = dragData(active);
			if (data) {
				builder.dragStart(data.item);
			}
		},
		onDragMove: track,
		onDragOver: track,
		onDragEnd: ({ active, over }: DragEndEvent) =>
			builder.drop(dropIndex(builder.blocks, active, over)),
		onDragCancel: builder.dragCancel,
	};
}
