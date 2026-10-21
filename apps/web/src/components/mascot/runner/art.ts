import {
	CELL,
	cellsOf,
	densify,
	type Point,
	traceCells,
} from "#/components/mascot/geometry";
import { BONE_HEIGHTS } from "#/components/mascot/runner/physics";

const SIDE_ROWS = [
	".......######....",
	".....##########..",
	"....############.",
	"...##############",
	"...##############",
	"..###############",
	"..###############",
	"..###############",
	"..###############",
	"..###############",
	".################",
	".################",
	".################",
	"#################",
	"#################",
	"###.####.#######.",
	"##...##...####...",
];

const SHIFT = -CELL / 2;

function loopsOf(rows: readonly string[], x: number, y: number) {
	return traceCells(cellsOf(rows), CELL, SHIFT + x * CELL, y * CELL).map(
		(loop) => densify(loop, 1.5),
	);
}

export type Loop = Point[];

export const SIDE_BODY: Loop[] = loopsOf(SIDE_ROWS, 0, 0);
export const SIDE_EYE: Loop[] = loopsOf([".#", "##", "##"], 12, 5);
export const SIDE_EYE_HURT: Loop[] = loopsOf(["##", "##", "##", "##"], 12, 4);
export const EYE_BOTTOM = 8 * CELL;
export const EYE_X = 12.5 * CELL + SHIFT;

export const BONE_CELL = 2.5;

const BONE_ROWS = [
	".##.......##.",
	"####.....####",
	".###########.",
	".###########.",
	"####.....####",
	".##.......##.",
];
const BONE_GAP = ".............";

export type Run = { row: number; start: number; length: number };

function runsOf(rows: readonly string[]): Run[] {
	const runs: Run[] = [];
	rows.forEach((row, y) => {
		let x = 0;
		while (x < row.length) {
			if (row[x] !== "#") {
				x++;
				continue;
			}
			const start = x;
			while (row[x] === "#") {
				x++;
			}
			runs.push({ row: y, start, length: x - start });
		}
	});
	return runs;
}

export const BONE_RUNS: Record<number, { rows: number; runs: Run[] }> =
	Object.fromEntries(
		BONE_HEIGHTS.map((height) => {
			const stack = Math.max(
				1,
				Math.round((height / BONE_CELL + 1) / (BONE_ROWS.length + 1)),
			);
			const rows = Array.from({ length: stack }, (_, i) =>
				i === 0 ? BONE_ROWS : [BONE_GAP, ...BONE_ROWS],
			).flat();
			return [height, { rows: rows.length, runs: runsOf(rows) }];
		}),
	);

export const DIGIT_RUNS: Run[][] = [
	["###", "#.#", "#.#", "#.#", "###"],
	[".#.", "##.", ".#.", ".#.", "###"],
	["###", "..#", "###", "#..", "###"],
	["###", "..#", ".##", "..#", "###"],
	["#.#", "#.#", "###", "..#", "..#"],
	["###", "#..", "###", "..#", "###"],
	["###", "#..", "###", "#.#", "###"],
	["###", "..#", ".#.", ".#.", ".#."],
	["###", "#.#", "###", "#.#", "###"],
	["###", "#.#", "###", "..#", "###"],
].map(runsOf);
