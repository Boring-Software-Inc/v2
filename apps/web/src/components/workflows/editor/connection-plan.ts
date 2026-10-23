import {
	getBezierPath,
	getStraightPath,
	Position,
	type XYPosition,
} from "@xyflow/react";

const STRAIGHT_BAND = 24;
const PREVIEW_LEAD = 32;

export function previewSides(
	from: XYPosition,
	to: XYPosition,
): { sourcePosition: Position; targetPosition: Position } | null {
	if (to.x >= from.x) {
		return { sourcePosition: Position.Right, targetPosition: Position.Left };
	}
	if (Math.abs(to.y - from.y) < STRAIGHT_BAND) {
		return null;
	}
	return {
		sourcePosition: Position.Right,
		targetPosition: to.y > from.y ? Position.Top : Position.Bottom,
	};
}

export function previewPath(from: XYPosition, to: XYPosition): string {
	const sides = previewSides(from, to);
	const ends = {
		sourceX: from.x,
		sourceY: from.y,
		targetX: to.x,
		targetY: to.y,
	};
	if (!sides) {
		return getStraightPath(ends)[0];
	}
	if (sides.targetPosition === Position.Left) {
		return getBezierPath({ ...ends, ...sides })[0];
	}
	const lead = Math.min(PREVIEW_LEAD, from.x - to.x);
	const bend = to.y - (to.y - from.y) / 2;
	return `M${from.x},${from.y} C${from.x + lead},${from.y} ${to.x},${bend} ${to.x},${to.y}`;
}
