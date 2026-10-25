import {
	type Active,
	type Announcements,
	type CollisionDetection,
	closestCenter,
	type DragEndEvent,
	type DragMoveEvent,
	type DragStartEvent,
	type KeyboardCoordinateGetter,
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
import type { ResponseBlock } from "@tripwire/contracts";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";
import {
	type DragItem,
	dropIndexFor,
	dropPosition,
	verticalStep,
} from "#/lib/block-builder";

export const CANVAS_DROP_ID = "block-canvas";

export interface BlockDragData {
	item: DragItem;
	label: string;
}

const blockCollision: CollisionDetection = (args) => {
	const canvas = args.droppableContainers.filter(
		(container) => container.id === CANVAS_DROP_ID,
	);
	const blocks = args.droppableContainers.filter(
		(container) => container.id !== CANVAS_DROP_ID,
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

const blockStep: KeyboardCoordinateGetter = (
	event,
	{ context, currentCoordinates },
) => {
	const direction =
		event.code === "ArrowDown"
			? "down"
			: event.code === "ArrowUp"
				? "up"
				: null;
	const rect = context.collisionRect;
	if (!(direction && rect)) {
		return undefined;
	}
	event.preventDefault();
	const centers = [...context.droppableRects]
		.filter(([id]) => id !== CANVAS_DROP_ID && id !== context.active?.id)
		.map(([, other]) => other.top + other.height / 2);
	const y = verticalStep(direction, rect.top, rect.height, centers);
	return y === null ? undefined : { ...currentCoordinates, y };
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
		"Press enter to edit this block. Press space to pick it up, the up and down arrows to move it, space to drop it and escape to cancel.",
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
	if (over.id === CANVAS_DROP_ID) {
		return blocks.length;
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
			coordinateGetter: blockStep,
			keyboardCodes: KEYBOARD_CODES,
		}),
	);
	const track = ({ active, over }: DragMoveEvent) =>
		builder.dragOver(dropIndex(builder.blocks, active, over));

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
