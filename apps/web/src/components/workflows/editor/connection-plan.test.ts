import { describe, expect, test } from "bun:test";
import { Position } from "@xyflow/react";
import {
	previewPath,
	previewSides,
} from "#/components/workflows/editor/connection-plan";

function controls(path: string): number[][] {
	return [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((match) => [
		Number(match[1]),
		Number(match[2]),
	]);
}

describe("pick mode preview line", () => {
	const from = { x: 500, y: 100 };

	test("a drop to the right keeps the usual left-entering curve", () => {
		expect(previewSides(from, { x: 800, y: 300 })).toEqual({
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		});
	});

	test("a drop left and below bends down toward the point", () => {
		expect(previewSides(from, { x: 200, y: 400 })).toEqual({
			sourcePosition: Position.Right,
			targetPosition: Position.Top,
		});
		expect(previewSides(from, { x: 200, y: -200 })?.targetPosition).toBe(
			Position.Bottom,
		);
	});

	test("a drop level with the port and left of it is straight", () => {
		expect(previewSides(from, { x: 100, y: 110 })).toBeNull();
		expect(previewPath(from, { x: 100, y: 110 })).toBe("M 500,100L 100,110");
	});

	test("no control point swings back past the drop or far right of the port", () => {
		for (const to of [
			{ x: 200, y: 400 },
			{ x: 0, y: -300 },
			{ x: 450, y: 60 },
		]) {
			const points = controls(previewPath(from, to));
			for (const [x] of points) {
				expect(x).toBeGreaterThanOrEqual(to.x);
				expect(x).toBeLessThanOrEqual(from.x + 40);
			}
		}
	});
});
