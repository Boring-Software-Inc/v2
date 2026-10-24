import { describe, expect, test } from "bun:test";
import {
	DISSOLVE_MS,
	dissolveCells,
	dissolveDensity,
} from "#/components/agent/dither-dissolve";

describe("dissolveDensity", () => {
	test("the noise seeds at 15 percent, peaks at 38, thins to 16, and is gone by 340 ms", () => {
		expect(DISSOLVE_MS).toBe(340);
		expect(dissolveDensity(0)).toBeCloseTo(0.15, 6);
		expect(dissolveDensity(120)).toBeCloseTo(0.38, 6);
		expect(dissolveDensity(220)).toBeCloseTo(0.16, 6);
		expect(dissolveDensity(340)).toBe(0);
	});

	test("between stops it moves in a straight line, and nothing shows outside the window", () => {
		expect(dissolveDensity(60)).toBeCloseTo(0.265, 6);
		expect(dissolveDensity(-1)).toBe(0);
		expect(dissolveDensity(500)).toBe(0);
	});
});

describe("dissolveCells", () => {
	test("about the asked share of the footprint lights", () => {
		const total = (224 / 2) * (88 / 2);
		for (const density of [0.15, 0.38]) {
			const lit = dissolveCells(224, 88, density).length / total;
			expect(Math.abs(lit - density)).toBeLessThan(0.04);
		}
		expect(dissolveCells(224, 88, 0)).toEqual([]);
	});

	test("a cell lit at a lower density stays lit at a higher one", () => {
		const low = new Set(
			dissolveCells(100, 40, 0.16).map((cell) => `${cell.col}:${cell.row}`),
		);
		const high = new Set(
			dissolveCells(100, 40, 0.38).map((cell) => `${cell.col}:${cell.row}`),
		);
		for (const key of low) {
			expect(high.has(key)).toBe(true);
		}
	});
});
