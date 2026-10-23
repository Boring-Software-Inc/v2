import { describe, expect, test } from "bun:test";
import {
	codeHalves,
	emptyCells,
	eraseAt,
	fillFrom,
	formatCode,
	isComplete,
	normalizeCode,
	typeAt,
} from "#/components/agents/device-code";

describe("normalizeCode", () => {
	test("drops the dash and spaces and uppercases", () => {
		expect(normalizeCode(" yru2-lv9k ")).toBe("YRU2LV9K");
	});

	test("formats a full code as two groups of four", () => {
		expect(formatCode("yru2lv9k")).toBe("YRU2-LV9K");
		expect(formatCode("YRU2-LV9K")).toBe("YRU2-LV9K");
	});

	test("leaves a code of another length ungrouped", () => {
		expect(formatCode("abc")).toBe("ABC");
	});

	test("splits a code into two halves for the boxes", () => {
		expect(codeHalves("YRU2-LV9K")).toEqual([
			["Y", "R", "U", "2"],
			["L", "V", "9", "K"],
		]);
	});
});

describe("typing", () => {
	test("a typed character fills the box and moves on", () => {
		const edit = typeAt(emptyCells(), 0, "y");
		expect(edit.cells[0]).toBe("Y");
		expect(edit.focus).toBe(1);
	});

	test("typing over a filled box replaces it", () => {
		const cells = emptyCells();
		cells[2] = "A";
		const edit = typeAt(cells, 2, "Ab");
		expect(edit.cells[2]).toBe("B");
		expect(edit.cells[3]).toBe("");
		expect(edit.focus).toBe(3);
	});

	test("characters outside the code alphabet are ignored", () => {
		const edit = typeAt(emptyCells(), 0, "-");
		expect(edit.cells).toEqual(emptyCells());
		expect(edit.focus).toBe(0);
	});

	test("the last box keeps focus once filled", () => {
		const edit = typeAt(emptyCells(), 7, "k");
		expect(edit.cells[7]).toBe("K");
		expect(edit.focus).toBe(7);
	});
});

describe("paste", () => {
	test("a full code with a dash fills every box from any box", () => {
		const edit = fillFrom(emptyCells(), 5, "yru2-lv9k");
		expect(edit.cells.join("")).toBe("YRU2LV9K");
		expect(isComplete(edit.cells)).toBe(true);
		expect(edit.focus).toBe(7);
	});

	test("a full code without a dash fills every box", () => {
		const edit = fillFrom(emptyCells(), 0, "YRU2LV9K");
		expect(edit.cells.join("")).toBe("YRU2LV9K");
	});

	test("a partial paste fills from the focused box", () => {
		const edit = fillFrom(emptyCells(), 4, "lv");
		expect(edit.cells).toEqual(["", "", "", "", "L", "V", "", ""]);
		expect(edit.focus).toBe(6);
	});

	test("a paste never runs past the last box", () => {
		const edit = fillFrom(emptyCells(), 6, "abc");
		expect(edit.cells.slice(6)).toEqual(["A", "B"]);
		expect(edit.cells).toHaveLength(8);
	});
});

describe("backspace", () => {
	test("clears a filled box and stays", () => {
		const cells = [..."YRU2LV9K"];
		const edit = eraseAt(cells, 3);
		expect(edit.cells[3]).toBe("");
		expect(edit.focus).toBe(3);
	});

	test("on an empty box goes back and clears the one before", () => {
		const cells = ["Y", "R", "U", "2", "", "", "", ""];
		const edit = eraseAt(cells, 4);
		expect(edit.cells[3]).toBe("");
		expect(edit.focus).toBe(3);
	});

	test("on the first empty box stays put", () => {
		const edit = eraseAt(emptyCells(), 0);
		expect(edit.focus).toBe(0);
	});

	test("the code is incomplete until all eight are filled", () => {
		expect(isComplete(["Y", "R", "U", "2", "L", "V", "9", ""])).toBe(false);
		expect(isComplete([..."YRU2LV9K"])).toBe(true);
	});
});
