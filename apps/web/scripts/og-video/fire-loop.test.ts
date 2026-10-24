import { describe, expect, test } from "bun:test";
import {
	FIRE_LOOP_FRAMES,
	fireFieldFromLevels,
	fireFrameLevels,
} from "./fire-loop";

const COLS = 24;
const ROWS = 30;

function flame(): Uint8Array {
	const levels = new Uint8Array(COLS * ROWS);
	for (let y = 0; y < ROWS; y++) {
		for (let x = 0; x < COLS; x++) {
			const height = 20 - Math.abs(x - COLS / 2) * 1.5;
			const depth = ROWS - 1 - y;
			levels[y * COLS + x] =
				depth < height ? Math.min(3, 1 + ((height - depth) >> 3)) : 0;
		}
	}
	return levels;
}

describe("fireFrameLevels", () => {
	const field = fireFieldFromLevels(flame(), COLS, ROWS, 3);

	test("the last frame flows into the first", () => {
		expect(fireFrameLevels(field, 1, 3)).toEqual(fireFrameLevels(field, 0, 3));
	});

	test("frames move", () => {
		const first = fireFrameLevels(field, 0, 3);
		const later = fireFrameLevels(field, 12 / FIRE_LOOP_FRAMES, 3);
		expect(later).not.toEqual(first);
	});

	test("the fire keeps its silhouette", () => {
		for (let frame = 0; frame < FIRE_LOOP_FRAMES; frame += 6) {
			const levels = fireFrameLevels(field, frame / FIRE_LOOP_FRAMES, 3);
			expect(levels[0]).toBe(0);
			expect(levels[(ROWS - 1) * COLS + COLS / 2]).toBeGreaterThan(0);
			expect(Math.max(...levels)).toBeLessThanOrEqual(3);
		}
	});

	test("an empty field never catches fire", () => {
		const empty = fireFieldFromLevels(
			new Uint8Array(COLS * ROWS),
			COLS,
			ROWS,
			3,
		);
		expect(fireFrameLevels(empty, 0.3, 3).every((level) => level === 0)).toBe(
			true,
		);
	});
});
