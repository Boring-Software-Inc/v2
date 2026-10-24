import { BAYER4, fnv1a } from "#/components/dither/pixel";

export const DISSOLVE_MS = 340;
export const DISSOLVE_CELL = 2;

const STOPS: readonly (readonly [number, number])[] = [
	[0, 0.15],
	[120, 0.38],
	[220, 0.16],
	[DISSOLVE_MS, 0],
];

export function dissolveDensity(ms: number): number {
	if (ms < 0 || ms >= DISSOLVE_MS) {
		return 0;
	}
	for (let i = 1; i < STOPS.length; i++) {
		const [toMs, to] = STOPS[i] ?? [DISSOLVE_MS, 0];
		const [fromMs, from] = STOPS[i - 1] ?? [0, 0];
		if (ms <= toMs) {
			return from + ((to - from) * (ms - fromMs)) / (toMs - fromMs);
		}
	}
	return 0;
}

function threshold(col: number, row: number): number {
	const shift = fnv1a(`${col >> 2}:${row >> 2}`);
	const x = (col + (shift & 3)) % 4;
	const y = (row + ((shift >> 2) & 3)) % 4;
	const rank = (BAYER4[y]?.[x] ?? 0.5) * 16 - 0.5;
	const noise = fnv1a(`${col}:${row}`) / 0x1_0000_0000;
	return (rank + noise) / 16;
}

export function dissolveCells(
	width: number,
	height: number,
	density: number,
): { col: number; row: number }[] {
	if (density <= 0) {
		return [];
	}
	const cols = Math.ceil(width / DISSOLVE_CELL);
	const rows = Math.ceil(height / DISSOLVE_CELL);
	const cells: { col: number; row: number }[] = [];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			if (threshold(col, row) < density) {
				cells.push({ col, row });
			}
		}
	}
	return cells;
}
