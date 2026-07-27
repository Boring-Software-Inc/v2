import { describe, expect, test } from "bun:test";
import {
	encodePng,
	renderDitherChart,
	renderSparklinePng,
} from "./sparkline-png.ts";

/** A minimal PNG parser: verify signature, then read IHDR width/height and the
 * chunk sequence. Enough to prove the encoder emits a structurally valid PNG a
 * decoder (Discord) will accept, without pulling in an image library. */
function readPng(bytes: Uint8Array): {
	width: number;
	height: number;
	chunks: string[];
} {
	const sig = [137, 80, 78, 71, 13, 10, 26, 10];
	for (let i = 0; i < sig.length; i++) {
		if (bytes[i] !== sig[i]) {
			throw new Error("bad signature");
		}
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunks: string[] = [];
	let width = 0;
	let height = 0;
	let offset = 8;
	while (offset < bytes.length) {
		const len = view.getUint32(offset);
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		chunks.push(type);
		if (type === "IHDR") {
			width = view.getUint32(offset + 8);
			height = view.getUint32(offset + 12);
		}
		offset += 12 + len; // length(4) + type(4) + data(len) + crc(4)
	}
	return { width, height, chunks };
}

describe("encodePng", () => {
	test("emits a valid PNG: signature, IHDR dims, IDAT, IEND in order", () => {
		const png = encodePng(4, 3, new Uint8Array(4 * 3 * 4));
		const { width, height, chunks } = readPng(png);
		expect(width).toBe(4);
		expect(height).toBe(3);
		expect(chunks).toEqual(["IHDR", "IDAT", "IEND"]);
	});
});

describe("renderSparklinePng", () => {
	test("renders overlaid series at the requested size", () => {
		const png = renderSparklinePng(
			[
				{ values: [1, 2, 2, 3, 5, 3, 4, 5], color: [88, 101, 242] },
				{ values: [1, 1, 2, 2, 3, 2, 3, 3], color: [254, 231, 92] },
			],
			{ width: 360, height: 120 },
		);
		const { width, height, chunks } = readPng(png);
		expect(width).toBe(360);
		expect(height).toBe(120);
		expect(chunks[0]).toBe("IHDR");
		expect(chunks.at(-1)).toBe("IEND");
		// A drawn chart is larger than a same-size blank canvas would compress to.
		expect(png.length).toBeGreaterThan(200);
	});

	test("degenerate inputs never throw: empty, single point, flat", () => {
		expect(() => renderSparklinePng([])).not.toThrow();
		expect(() =>
			renderSparklinePng([{ values: [5], color: [0, 0, 0] }]),
		).not.toThrow();
		expect(() =>
			renderSparklinePng([{ values: [2, 2, 2], color: [0, 0, 0] }]),
		).not.toThrow();
	});
});

describe("renderDitherChart", () => {
	test("renders overlaid dither areas at the requested size", () => {
		const png = renderDitherChart(
			[
				{ values: [1, 2, 2, 3, 5, 3, 4, 5], color: [88, 101, 242] },
				{ values: [1, 1, 2, 2, 3, 2, 3, 3], color: [254, 231, 92] },
			],
			{ width: 480, height: 160 },
		);
		const { width, height, chunks } = readPng(png);
		expect(width).toBe(480);
		expect(height).toBe(160);
		expect(chunks[0]).toBe("IHDR");
		expect(chunks.at(-1)).toBe("IEND");
		// A painted dither area compresses larger than a blank canvas would.
		expect(png.length).toBeGreaterThan(400);
	});

	test("degenerate inputs never throw", () => {
		expect(() => renderDitherChart([])).not.toThrow();
		expect(() =>
			renderDitherChart([{ values: [2, 2], color: [0, 0, 0] }]),
		).not.toThrow();
	});
});
