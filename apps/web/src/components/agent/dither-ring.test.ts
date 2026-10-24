import { describe, expect, test } from "bun:test";
import {
	cellLit,
	DEFAULT_RING,
	ringCells,
	ringGeometry,
	ringIntensity,
} from "#/components/agent/dither-ring";

const { band: RING_BAND, cell: RING_CELL, pad: RING_PAD } = DEFAULT_RING;

describe("ringGeometry", () => {
	test("the default tokens keep the current 6 px band of 2 px cells", () => {
		expect(ringGeometry("6px", "2")).toEqual({
			cell: 2,
			band: 3,
			gap: 2,
			pad: 8,
		});
		expect(DEFAULT_RING).toEqual(ringGeometry("6px", "2"));
	});

	test("a wider outline adds cell rows, a larger scale makes coarser cells", () => {
		expect(ringGeometry("12px", "2")).toMatchObject({ band: 6, pad: 14 });
		expect(ringGeometry("8px", "4")).toEqual({
			cell: 4,
			band: 2,
			gap: 2,
			pad: 10,
		});
	});

	test("a missing or broken token falls back to the default", () => {
		expect(ringGeometry("", "")).toEqual(DEFAULT_RING);
		expect(ringGeometry("wide", "-1")).toEqual(DEFAULT_RING);
	});

	test("the band follows the geometry it is given", () => {
		const wide = ringGeometry("12px", "2");
		const cells = ringCells(100, 40, 8, wide);
		const topMiddle = cells.filter(
			(cell) => cell.col === Math.floor((wide.pad + 50) / wide.cell),
		);
		expect(
			topMiddle.filter((cell) => cell.row < wide.pad / wide.cell),
		).toHaveLength(6);
	});
});

describe("ringCells", () => {
	const cells = ringCells(100, 40, 8);

	test("every cell sits in the band outside the box, never over it", () => {
		for (const cell of cells) {
			const x = (cell.col + 0.5) * RING_CELL - RING_PAD;
			const y = (cell.row + 0.5) * RING_CELL - RING_PAD;
			const inside = x > 0 && x < 100 && y > 0 && y < 40;
			expect(inside).toBe(false);
			expect(cell.depth).toBeGreaterThanOrEqual(0);
			expect(cell.depth).toBeLessThan(1);
		}
	});

	test("the band wraps the whole edge, top left round to the left side", () => {
		const us = cells.map((cell) => cell.u);
		expect(Math.min(...us)).toBeLessThan(0.02);
		expect(Math.max(...us)).toBeGreaterThan(0.98);
		const rows = new Set(cells.map((cell) => cell.row));
		expect(rows.size).toBeGreaterThan(40 / RING_CELL);
	});

	test("the band is as deep as its cell rows", () => {
		const topMiddle = cells.filter(
			(cell) => cell.col === Math.floor((RING_PAD + 50) / RING_CELL),
		);
		expect(
			topMiddle.filter((cell) => cell.row < RING_PAD / RING_CELL),
		).toHaveLength(RING_BAND);
	});
});

describe("ringIntensity", () => {
	const cell = { col: 3, row: 1, u: 0.5, depth: 0 };

	test("a still ring is the same at any moment", () => {
		const a = ringIntensity(cell, {
			action: "write",
			elapsed: 10,
			clock: 0,
			still: true,
		});
		const b = ringIntensity(cell, {
			action: "write",
			elapsed: 900,
			clock: 5000,
			still: true,
		});
		expect(a).toBe(b);
	});

	test("a write sweeps past: the cell is brighter while the head passes it", () => {
		const idle = ringIntensity(cell, {
			action: "write",
			elapsed: 5000,
			clock: 0,
			still: false,
		});
		const passing = ringIntensity(cell, {
			action: "write",
			elapsed: 340,
			clock: 0,
			still: false,
		});
		expect(passing).toBeGreaterThan(idle);
	});

	test("a delete fades the ring out over its 800 ms", () => {
		const early = ringIntensity(
			{ ...cell, u: 0.99 },
			{ action: "delete", elapsed: 50, clock: 0, still: false },
		);
		const late = ringIntensity(
			{ ...cell, u: 0.99 },
			{ action: "delete", elapsed: 790, clock: 0, still: false },
		);
		expect(late).toBeLessThan(early);
	});
});

describe("cellLit", () => {
	test("full intensity lights every cell and none lights none", () => {
		for (let row = 0; row < 4; row++) {
			for (let col = 0; col < 4; col++) {
				const cell = { col, row, u: 0, depth: 0 };
				expect(cellLit(cell, 1)).toBe(true);
				expect(cellLit(cell, 0)).toBe(false);
			}
		}
	});

	test("half intensity lights half of a 4 by 4 tile", () => {
		let lit = 0;
		for (let row = 0; row < 4; row++) {
			for (let col = 0; col < 4; col++) {
				lit += cellLit({ col, row, u: 0, depth: 0 }, 0.5) ? 1 : 0;
			}
		}
		expect(lit).toBe(8);
	});
});
