import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodePng } from "#/lib/server/og/raster";
import { siteOgFrames } from "#/lib/server/og/site-og-video";

const WEB = new URL("../../../../", import.meta.url);
const og = readFileSync(new URL("public/og.png", WEB));
const field = readFileSync(new URL("scripts/assets/og-fire-field.png", WEB));

function changed(a: Uint8Array, b: Uint8Array, box: number[]) {
	const [left = 0, top = 0, right = 0, bottom = 0] = box;
	let count = 0;
	for (let y = top; y < bottom; y++) {
		for (let x = left; x < right; x++) {
			const i = (y * 1200 + x) * 4;
			if ([0, 1, 2].some((c) => a[i + c] !== b[i + c])) {
				count++;
			}
		}
	}
	return count;
}

describe("siteOgFrames", () => {
	const still = decodePng(og, 1200, 630).pixels;
	const frame = siteOgFrames(og, field);

	test("the copy and the app window never change", () => {
		for (const index of [0, 13, 31]) {
			const pixels = frame(index);
			expect(changed(pixels, still, [60, 50, 760, 220])).toBe(0);
			expect(changed(pixels, still, [329, 299, 1200, 630])).toBe(0);
		}
	});

	test("the fire moves", () => {
		expect(changed(frame(0), frame(8), [0, 300, 329, 630])).toBeGreaterThan(
			500,
		);
	});
});
