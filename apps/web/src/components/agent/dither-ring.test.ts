import { describe, expect, test } from "bun:test";
import {
	DEFAULT_RING,
	DEFAULT_SHIMMER,
	ringCells,
	ringGeometry,
	ringPhase,
	ringTiming,
	segmentLit,
	segmentStrength,
	trackAlpha,
} from "#/components/agent/dither-ring";

describe("ringGeometry", () => {
	test("the default tokens give a 1 px track 2 px out with a 3 px segment of 1 px cells", () => {
		expect(DEFAULT_RING).toEqual({
			cell: 1,
			gap: 2,
			track: 1,
			band: 3,
			pad: 5,
		});
	});

	test("every knob comes from its token", () => {
		expect(
			ringGeometry({ gap: "4px", track: "2px", segment: "4px", scale: "2" }),
		).toEqual({ cell: 2, gap: 4, track: 2, band: 2, pad: 8 });
	});

	test("a missing or broken token falls back to the default", () => {
		expect(
			ringGeometry({ gap: "", track: "wide", segment: "-1", scale: "" }),
		).toEqual(DEFAULT_RING);
	});
});

describe("ringTiming", () => {
	test("the default lap is 2.4 s, the breath 2.8 s, the segment 18 percent", () => {
		expect(DEFAULT_SHIMMER).toEqual({
			lapMs: 2400,
			breatheMs: 2800,
			length: 0.18,
		});
	});

	test("reads ms and a fraction, and falls back on nonsense", () => {
		expect(ringTiming({ lap: "3000ms", breathe: "2s", length: "0.2" })).toEqual(
			{ lapMs: 3000, breatheMs: 2000, length: 0.2 },
		);
		expect(ringTiming({ lap: "", breathe: "x", length: "4" })).toEqual(
			DEFAULT_SHIMMER,
		);
	});
});

describe("ringCells", () => {
	const ring = DEFAULT_RING;
	const cells = ringCells(100, 40, 11, ring);

	test("every cell sits outside the rounded box, never over it", () => {
		for (const cell of cells) {
			const x = (cell.col + 0.5) * ring.cell - ring.pad;
			const y = (cell.row + 0.5) * ring.cell - ring.pad;
			const besideCorner = (x > 11 && x < 89) || (y > 11 && y < 29);
			expect(besideCorner && x > 0 && x < 100 && y > 0 && y < 40).toBe(false);
		}
	});

	test("the band is as deep as the segment and wraps the whole edge", () => {
		const topMiddle = cells.filter(
			(cell) => cell.col === Math.floor((ring.pad + 50) / ring.cell),
		);
		expect(topMiddle.filter((cell) => cell.row < ring.pad)).toHaveLength(3);
		const us = cells.map((cell) => cell.u);
		expect(Math.min(...us)).toBeLessThan(0.02);
		expect(Math.max(...us)).toBeGreaterThan(0.98);
	});
});

describe("trackAlpha", () => {
	test("a still track holds one level", () => {
		expect(trackAlpha(0, true)).toBe(trackAlpha(1234, true));
	});

	test("the track breathes gently and repeats each breath", () => {
		const levels = Array.from({ length: 28 }, (_, i) =>
			trackAlpha(i * 100, false),
		);
		expect(Math.min(...levels)).toBeGreaterThanOrEqual(0.5);
		expect(Math.max(...levels)).toBeLessThanOrEqual(1);
		expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.2);
		expect(trackAlpha(700, false)).toBeCloseTo(trackAlpha(3500, false), 6);
	});
});

describe("segmentStrength", () => {
	test("the segment travels one lap every 2.4 s", () => {
		expect(segmentStrength(0, 0, 0)).toBe(1);
		expect(segmentStrength(0.5, 1200, 0)).toBe(1);
		expect(segmentStrength(0.5, 0, 0)).toBe(0);
		expect(segmentStrength(0.25, 2400 * 0.25, 0)).toBe(1);
	});

	test("the phase shifts where the segment is", () => {
		expect(segmentStrength(0.3, 0, 0.3)).toBe(1);
	});

	test("the ends fade softly and wrap past the top left", () => {
		const edge = segmentStrength(0.08, 0, 0);
		expect(edge).toBeGreaterThan(0);
		expect(edge).toBeLessThan(1);
		expect(segmentStrength(0.97, 0, 0)).toBeGreaterThan(0);
		expect(segmentStrength(0.2, 0, 0)).toBe(0);
	});
});

describe("segmentLit", () => {
	const cell = { col: 7, row: 1, u: 0.075, depth: 1 / 3 };

	test("nothing outside the segment ever lights", () => {
		for (let lap = 0; lap < 40; lap += 1) {
			expect(segmentLit({ ...cell, u: 0.5 }, lap * 2400, 0)).toBe(false);
		}
	});

	test("a cell on the soft end twinkles as the dither shifts", () => {
		const states = new Set<boolean>();
		for (let clock = 0; clock < 60; clock += 1) {
			states.add(segmentLit(cell, clock * 2400, 0));
		}
		expect(states.size).toBe(2);
	});
});

describe("ringPhase", () => {
	test("each seed starts its lap at its own place", () => {
		expect(ringPhase("warn")).toBe(ringPhase("warn"));
		expect(ringPhase("warn")).not.toBe(ringPhase("close"));
		expect(ringPhase("warn")).toBeGreaterThanOrEqual(0);
		expect(ringPhase("warn")).toBeLessThan(1);
	});
});
