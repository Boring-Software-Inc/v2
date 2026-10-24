import { BAYER4, clamp01, fnv1a } from "#/components/dither/pixel";

const SHIMMER_MS = 90;
const SOFT_END = 0.5;
const TRACK_LOW = 0.6;
const TRACK_HIGH = 0.95;
const TRACK_STILL = 0.85;

export interface RingGeometry {
	cell: number;
	gap: number;
	track: number;
	band: number;
	pad: number;
}

export interface RingTokens {
	gap: string;
	track: string;
	segment: string;
	scale: string;
}

export interface ShimmerTiming {
	lapMs: number;
	breatheMs: number;
	length: number;
}

export interface RingCell {
	col: number;
	row: number;
	u: number;
	depth: number;
}

function positive(value: string, fallback: number): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function duration(value: string, fallback: number): number {
	const parsed = positive(value, 0);
	if (parsed === 0) {
		return fallback;
	}
	return /\dms\s*$/.test(value) || !/s\s*$/.test(value)
		? parsed
		: parsed * 1000;
}

export function ringGeometry(tokens: RingTokens): RingGeometry {
	const cell = positive(tokens.scale, 1);
	const gap = positive(tokens.gap, 2);
	const track = positive(tokens.track, 1);
	const band = Math.max(1, Math.round(positive(tokens.segment, 3) / cell));
	return { cell, gap, track, band, pad: gap + Math.max(track, band * cell) };
}

export function ringTiming(tokens: {
	lap: string;
	breathe: string;
	length: string;
}): ShimmerTiming {
	const length = positive(tokens.length, 0.18);
	return {
		lapMs: duration(tokens.lap, 2400),
		breatheMs: duration(tokens.breathe, 2800),
		length: length < 1 ? length : 0.18,
	};
}

export const DEFAULT_RING = ringGeometry({
	gap: "",
	track: "",
	segment: "",
	scale: "",
});

export const DEFAULT_SHIMMER = ringTiming({ lap: "", breathe: "", length: "" });

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
 * The cells of the segment's band just outside a rounded box, past the gap,
 * each with its place along the edge (u, clockwise from the top left) and
 * how far out it sits (depth, 0 at the inner row on the track).
 */
export function ringCells(
	width: number,
	height: number,
	radius: number,
	ring: RingGeometry,
): RingCell[] {
	const cols = Math.ceil((width + ring.pad * 2) / ring.cell);
	const rows = Math.ceil((height + ring.pad * 2) / ring.cell);
	const halfWidth = width / 2;
	const halfHeight = height / 2;
	const r = Math.max(0, Math.min(radius, halfWidth, halfHeight));
	const band = ring.band * ring.cell;
	const cells: RingCell[] = [];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const x = (col + 0.5) * ring.cell - ring.pad - halfWidth;
			const y = (row + 0.5) * ring.cell - ring.pad - halfHeight;
			const qx = Math.abs(x) - halfWidth + r;
			const qy = Math.abs(y) - halfHeight + r;
			const outside =
				Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
				Math.min(Math.max(qx, qy), 0) -
				r;
			const d = outside - ring.gap;
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

function frac(value: number): number {
	return value - Math.floor(value);
}

function smooth(t: number): number {
	return t * t * (3 - 2 * t);
}

export function trackAlpha(
	clock: number,
	still: boolean,
	timing: ShimmerTiming = DEFAULT_SHIMMER,
): number {
	if (still) {
		return TRACK_STILL;
	}
	const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * (clock / timing.breatheMs));
	return TRACK_LOW + (TRACK_HIGH - TRACK_LOW) * wave;
}

export function segmentStrength(
	u: number,
	clock: number,
	phase: number,
	timing: ShimmerTiming = DEFAULT_SHIMMER,
): number {
	const head = frac(clock / timing.lapMs + phase);
	const apart = Math.abs(frac(u - head + 0.5) - 0.5);
	const half = timing.length / 2;
	if (apart >= half) {
		return 0;
	}
	const soft = half * SOFT_END;
	return apart <= half - soft ? 1 : smooth((half - apart) / soft);
}

export function segmentLit(
	cell: RingCell,
	clock: number,
	phase: number,
	timing: ShimmerTiming = DEFAULT_SHIMMER,
): boolean {
	const strength = segmentStrength(cell.u, clock, phase, timing);
	if (strength === 0) {
		return false;
	}
	const weight = 1 - 0.25 * Math.sin(Math.PI * cell.depth);
	const bayer = BAYER4[cell.row % 4]?.[cell.col % 4] ?? 0.5;
	const window = Math.floor(clock / SHIMMER_MS);
	const noise = fnv1a(`${cell.col}:${cell.row}:${window}`) / 0x1_0000_0000;
	return strength * weight > clamp01(bayer + (noise - 0.5) * 0.5);
}

export function ringPhase(seed: string): number {
	return fnv1a(seed) / 0x1_0000_0000;
}
