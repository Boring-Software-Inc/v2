import { describe, expect, test } from "bun:test";
import { type Box, PANEL_GAP, placePanel } from "./placement";

const viewport = { width: 1440, height: 900 };
const panel = { width: 300, height: 240 };

function overlaps(a: Box, b: Box): boolean {
	return (
		a.left < b.left + b.width &&
		b.left < a.left + a.width &&
		a.top < b.top + b.height &&
		b.top < a.top + a.height
	);
}

function panelBox(left: number, top: number): Box {
	return { left, top, ...panel };
}

describe("placePanel", () => {
	test("goes right of the element with a 16px gap when there is room", () => {
		const target = { left: 336, top: 300, width: 770, height: 80 };
		const at = placePanel(target, panel, viewport);
		expect(at).toEqual({
			side: "right",
			left: 336 + 770 + PANEL_GAP,
			top: 300,
		});
	});

	test("flips to the left near the right edge", () => {
		const target = { left: 1000, top: 200, width: 400, height: 60 };
		const at = placePanel(target, panel, viewport);
		expect(at.side).toBe("left");
		expect(at.left + panel.width).toBe(1000 - PANEL_GAP);
	});

	test("moves below when neither side has room", () => {
		const target = { left: 100, top: 100, width: 1240, height: 200 };
		const at = placePanel(target, panel, viewport);
		expect(at).toEqual({ side: "below", left: 100, top: 300 + PANEL_GAP });
	});

	test("moves above when below is too short", () => {
		const target = { left: 100, top: 600, width: 1240, height: 200 };
		const at = placePanel(target, panel, viewport);
		expect(at.side).toBe("above");
		expect(at.top + panel.height).toBe(600 - PANEL_GAP);
	});

	test("never covers the element when any side fits", () => {
		const targets: Box[] = [
			{ left: 0, top: 0, width: 200, height: 40 },
			{ left: 1240, top: 860, width: 200, height: 40 },
			{ left: 20, top: 400, width: 1400, height: 60 },
			{ left: 1300, top: 500, width: 140, height: 300 },
		];
		for (const target of targets) {
			const at = placePanel(target, panel, viewport);
			expect(at.side).not.toBe("pinned");
			expect(overlaps(panelBox(at.left, at.top), target)).toBe(false);
		}
	});

	test("keeps a side panel inside the viewport for a tall element", () => {
		const target = { left: 100, top: -400, width: 400, height: 2000 };
		const at = placePanel(target, panel, viewport);
		expect(at.side).toBe("right");
		expect(at.top).toBe(8);
	});

	test("stacks below on a phone", () => {
		const phone = { width: 390, height: 844 };
		const target = { left: 16, top: 120, width: 358, height: 80 };
		const at = placePanel(target, { width: 358, height: 240 }, phone);
		expect(at).toEqual({ side: "below", left: 16, top: 200 + PANEL_GAP });
	});

	test("pins to the bottom corner with no element", () => {
		const at = placePanel(null, panel, viewport);
		expect(at).toEqual({
			side: "pinned",
			left: 1440 - 8 - 300,
			top: 900 - 8 - 240,
		});
	});
});
