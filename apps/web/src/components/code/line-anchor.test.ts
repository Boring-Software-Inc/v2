import { describe, expect, test } from "bun:test";
import {
	formatLineAnchor,
	parseLineAnchor,
} from "#/components/code/line-anchor";

describe("line anchors", () => {
	test("a single line reads back as one line", () => {
		expect(parseLineAnchor("#L7")).toEqual({ start: 7, end: 7 });
		expect(formatLineAnchor({ start: 7, end: 7 })).toBe("#L7");
	});

	test("a range reads back in order, whichever way it was dragged", () => {
		expect(parseLineAnchor("#L12-L4")).toEqual({ start: 4, end: 12 });
		expect(formatLineAnchor({ start: 12, end: 4 })).toBe("#L4-L12");
	});

	test("anything else is not a line anchor", () => {
		for (const hash of ["", "#", "#L", "#L0", "#line-3", "#L3-", "L3"]) {
			expect(parseLineAnchor(hash)).toBeNull();
		}
	});

	test("no selection clears the anchor", () => {
		expect(formatLineAnchor(null)).toBe("");
	});
});
