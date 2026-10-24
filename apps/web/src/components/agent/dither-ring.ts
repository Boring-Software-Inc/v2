import type { AgentAction } from "@tripwire/contracts";
import { BAYER4, clamp01 } from "#/components/dither/pixel";

export const AGENT_ACTION_MS = {
	read: 1500,
	write: 1500,
	edit: 1000,
	delete: 800,
} satisfies Record<AgentAction, number>;

const ACTION_STRENGTH = {
	read: 0.45,
	write: 0.9,
	edit: 0.75,
	delete: 0.8,
} satisfies Record<AgentAction, number>;

export const RING_CELL = 2;
export const RING_BAND = 3;
export const RING_GAP = 2;
export const RING_PAD = RING_GAP + RING_BAND * RING_CELL;

const DRIFT_MS = 2600;
const TRAIL = 0.35;

export interface RingCell {
	col: number;
	row: number;
	u: number;
	depth: number;
}

function perimeterAt(
	x: number,
	y: number,
	halfWidth: number,
	halfHeight: number,
): number {
	const px = Math.max(-halfWidth, Math.min(halfWidth, x));
	const py = Math.max(-halfHeight, Math.min(halfHeight, y));
	const toTop = Math.abs(py + halfHeight);
	const toRight = Math.abs(px - halfWidth);
	const toBottom = Math.abs(py - halfHeight);
	const toLeft = Math.abs(px + halfWidth);
	const nearest = Math.min(toTop, toRight, toBottom, toLeft);
	const width = halfWidth * 2;
	const height = halfHeight * 2;
	const total = 2 * (width + height);
	let s: number;
	if (nearest === toTop) {
		s = px + halfWidth;
	} else if (nearest === toRight) {
		s = width + (py + halfHeight);
	} else if (nearest === toBottom) {
		s = width + height + (halfWidth - px);
	} else {
		s = 2 * width + height + (halfHeight - py);
	}
	return total > 0 ? (s / total) % 1 : 0;
}

/**
 * The cells of a dithered band just outside a rounded box of the given size,
 * each with its place along the edge (u, clockwise from the top left) and how
 * far out it sits (depth, 0 at the inner row).
 */
export function ringCells(
	width: number,
	height: number,
	radius: number,
): RingCell[] {
	const outerWidth = width + RING_PAD * 2;
	const outerHeight = height + RING_PAD * 2;
	const cols = Math.ceil(outerWidth / RING_CELL);
	const rows = Math.ceil(outerHeight / RING_CELL);
	const halfWidth = width / 2;
	const halfHeight = height / 2;
	const r = Math.max(0, Math.min(radius, halfWidth, halfHeight));
	const band = RING_BAND * RING_CELL;
	const cells: RingCell[] = [];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const x = (col + 0.5) * RING_CELL - RING_PAD - halfWidth;
			const y = (row + 0.5) * RING_CELL - RING_PAD - halfHeight;
			const qx = Math.abs(x) - halfWidth + r;
			const qy = Math.abs(y) - halfHeight + r;
			const outside =
				Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
				Math.min(Math.max(qx, qy), 0) -
				r;
			const d = outside - RING_GAP;
			if (d < 0 || d >= band) {
				continue;
			}
			cells.push({
				col,
				row,
				u: perimeterAt(x, y, halfWidth, halfHeight),
				depth: d / band,
			});
		}
	}
	return cells;
}

export interface RingMotion {
	action: AgentAction;
	elapsed: number;
	clock: number;
	still: boolean;
}

function easeOut(t: number): number {
	return 1 - (1 - t) ** 3;
}

/** How strongly one cell lights at a moment: a slow drift plus the action's sweep. */
export function ringIntensity(cell: RingCell, motion: RingMotion): number {
	const fade = 1 - cell.depth * 0.45;
	if (motion.still) {
		return 0.42 * fade;
	}
	const drift =
		0.3 + 0.12 * Math.sin(2 * Math.PI * (cell.u * 4 - motion.clock / DRIFT_MS));
	const duration = AGENT_ACTION_MS[motion.action];
	const progress = clamp01(motion.elapsed / duration);
	let sweep = 0;
	if (motion.elapsed < duration) {
		const head = easeOut(progress);
		const behind = (((head - cell.u) % 1) + 1) % 1;
		if (behind < TRAIL) {
			sweep =
				(1 - behind / TRAIL) *
				ACTION_STRENGTH[motion.action] *
				(1 - progress * 0.4);
		}
	}
	const base =
		motion.action === "delete" && motion.elapsed < duration
			? drift * (1 - progress)
			: drift;
	return clamp01((base + sweep) * fade);
}

/** Ordered dither: a cell shows when its intensity beats its Bayer threshold. */
export function cellLit(cell: RingCell, intensity: number): boolean {
	const threshold = BAYER4[cell.row % 4]?.[cell.col % 4] ?? 0.5;
	return intensity > threshold;
}
