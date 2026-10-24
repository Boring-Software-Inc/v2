import { BAYER4, clamp01 } from "#/components/dither/pixel";

export interface FireField {
	cols: number;
	rows: number;
	heat: Float32Array;
}

export const FIRE_LOOP_FPS = 16;
export const FIRE_LOOP_FRAMES = 48;

export interface FireMotion {
	rise: number;
	flicker: number;
	sway: number;
	turbulence: number;
}

export const FIRE_MOTION: FireMotion = {
	rise: 1,
	flicker: 0.1,
	sway: 2,
	turbulence: 0.45,
};

const TAU = Math.PI * 2;
const NOISE_PERIOD = 8;
const NOISE_WIDTH = 4;
const NOISE_HEIGHT = 8;

function hash(x: number, y: number): number {
	let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
	h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
	h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
	return ((h ^ (h >>> 15)) >>> 0) / 0x100000000;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function noise(x: number, y: number, period: number): number {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = smooth(x - x0);
	const fy = smooth(y - y0);
	const wrap = (v: number) => ((v % period) + period) % period;
	const ya = wrap(y0);
	const yb = wrap(y0 + 1);
	const top = hash(x0, ya) + (hash(x0 + 1, ya) - hash(x0, ya)) * fx;
	const bottom = hash(x0, yb) + (hash(x0 + 1, yb) - hash(x0, yb)) * fx;
	return top + (bottom - top) * fy;
}

function heatAt(field: FireField, x: number, y: number): number {
	if (x < 0 || x >= field.cols || y >= field.rows) {
		return 0;
	}
	if (y < 0) {
		return 0;
	}
	const y0 = Math.floor(y);
	const y1 = Math.min(y0 + 1, field.rows - 1);
	const t = y - y0;
	const a = field.heat[y0 * field.cols + x] ?? 0;
	const b = field.heat[y1 * field.cols + x] ?? 0;
	return a + (b - a) * t;
}

export function fireFieldFromLevels(
	levels: Uint8Array,
	cols: number,
	rows: number,
	maxLevel: number,
): FireField {
	const heat = new Float32Array(cols * rows);
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			let sum = 0;
			let count = 0;
			for (let dy = -2; dy <= 1; dy++) {
				for (let dx = -2; dx <= 1; dx++) {
					const sx = x + dx;
					const sy = y + dy;
					if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) {
						continue;
					}
					sum += levels[sy * cols + sx] ?? 0;
					count++;
				}
			}
			const own = (levels[y * cols + x] ?? 0) / maxLevel;
			const blurred = sum / count / maxLevel;
			heat[y * cols + x] = own > 0 ? Math.max(blurred, own * 0.5) : blurred;
		}
	}
	return { cols, rows, heat };
}

export function fireFrameLevels(
	field: FireField,
	phase: number,
	maxLevel: number,
	motion: FireMotion = FIRE_MOTION,
): Uint8Array {
	const { cols, rows } = field;
	const out = new Uint8Array(cols * rows);
	const turn = phase - Math.floor(phase);
	const scroll = turn * NOISE_PERIOD * motion.rise;
	for (let x = 0; x < cols; x++) {
		const offset = noise(x / 9, 0.5, 1 << 30) * 4;
		const stretch =
			1 + motion.flicker * Math.sin(TAU * (turn * motion.sway + offset));
		for (let y = 0; y < rows; y++) {
			const depth = rows - 1 - y;
			const heat = heatAt(field, x, rows - 1 - depth / stretch);
			if (heat <= 0) {
				continue;
			}
			const grain = noise(
				x / NOISE_WIDTH,
				y / NOISE_HEIGHT + scroll,
				NOISE_PERIOD,
			);
			const value = clamp01(heat * (1 + motion.turbulence * (grain - 0.5)));
			const threshold = BAYER4[y & 3]?.[x & 3] ?? 0.5;
			const scaled = value * maxLevel;
			const base = Math.floor(scaled);
			const level = scaled - base > threshold ? base + 1 : base;
			out[y * cols + x] = Math.min(maxLevel, level);
		}
	}
	return out;
}
