import {
	type FireField,
	type FireShape,
	fireFieldFromLevels,
	fireFrameLevels,
} from "#/lib/server/og/fire-loop";
import { blankRaster, type Raster } from "#/lib/server/og/raster";

export const GUTTER_COLS = 25;
export const GUTTER_ROWS = 70;
const CELL_WIDTH = 9.6;
const LINE_HEIGHT = 18;
const LINE_SHIFT = 1;
const BUCKETS = 6;
const GLYPH_HOLD = 2;
const GLYPH_SHAPE: FireShape = { keep: 0.9, spread: 0.3 };

interface Cell {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface Tile {
	cell: Cell;
	pixels: Uint8Array;
	ink: number;
}

export interface GlyphFire {
	tiles: Tile[][];
	fields: FireField[];
	width: number;
	height: number;
}

function cellAt(col: number, row: number, height: number): Cell {
	const left = Math.round(col * CELL_WIDTH);
	const right = Math.round((col + 1) * CELL_WIDTH);
	const top = Math.max(0, row * LINE_HEIGHT - LINE_SHIFT);
	const bottom = Math.min(height, (row + 1) * LINE_HEIGHT - LINE_SHIFT);
	return { left, top, width: right - left, height: bottom - top };
}

function cutTile(source: Raster, cell: Cell): Tile {
	const pixels = new Uint8Array(cell.width * cell.height * 4);
	let ink = 0;
	for (let y = 0; y < cell.height; y++) {
		const from = ((cell.top + y) * source.width + cell.left) * 4;
		const row = source.pixels.subarray(from, from + cell.width * 4);
		pixels.set(row, y * cell.width * 4);
		for (let i = 3; i < row.length; i += 4) {
			ink += row[i] ?? 0;
		}
	}
	return { cell, pixels, ink };
}

export function buildGlyphFire(gutters: Raster[]): GlyphFire {
	const first = gutters[0];
	if (!first) {
		throw new Error("glyph fire needs at least one gutter");
	}
	const cut = gutters.map((gutter) => {
		const tiles: Tile[] = [];
		for (let row = 0; row < GUTTER_ROWS; row++) {
			for (let col = 0; col < GUTTER_COLS; col++) {
				tiles.push(cutTile(gutter, cellAt(col, row, gutter.height)));
			}
		}
		return tiles;
	});
	const inked = cut
		.flat()
		.filter((tile) => tile.ink > 0)
		.sort((a, b) => a.ink - b.ink);
	const bucket = new Map<Tile, number>();
	const tiles: Tile[][] = Array.from({ length: BUCKETS + 1 }, () => []);
	inked.forEach((tile, index) => {
		const level = 1 + Math.floor((index / inked.length) * BUCKETS);
		bucket.set(tile, level);
		tiles[level]?.push(tile);
	});
	const fields = cut.map((side) =>
		fireFieldFromLevels(
			Uint8Array.from(side, (tile) => bucket.get(tile) ?? 0),
			GUTTER_COLS,
			GUTTER_ROWS,
			BUCKETS,
			GLYPH_SHAPE,
		),
	);
	return { tiles, fields, width: first.width, height: first.height };
}

function pick(list: Tile[], col: number, row: number, step: number) {
	let h = Math.imul(col + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b);
	h = Math.imul(h ^ Math.imul(step + 1, 0xc2b2ae35), 0x27d4eb2d);
	return list[((h ^ (h >>> 15)) >>> 0) % list.length];
}

export function paintGlyphFire(
	fire: GlyphFire,
	side: number,
	frame: number,
	frames: number,
): Raster {
	const out = blankRaster(fire.width, fire.height);
	const field = fire.fields[side];
	if (!field) {
		return out;
	}
	const levels = fireFrameLevels(field, frame / frames, BUCKETS);
	const step = Math.floor(frame / GLYPH_HOLD);
	for (let row = 0; row < GUTTER_ROWS; row++) {
		for (let col = 0; col < GUTTER_COLS; col++) {
			const level = levels[row * GUTTER_COLS + col] ?? 0;
			const tile = pick(fire.tiles[level] ?? [], col + side * 97, row, step);
			if (!tile) {
				continue;
			}
			const cell = cellAt(col, row, fire.height);
			const width = Math.min(cell.width, tile.cell.width);
			const height = Math.min(cell.height, tile.cell.height);
			for (let y = 0; y < height; y++) {
				const from = y * tile.cell.width * 4;
				out.pixels.set(
					tile.pixels.subarray(from, from + width * 4),
					((cell.top + y) * fire.width + cell.left) * 4,
				);
			}
		}
	}
	return out;
}
