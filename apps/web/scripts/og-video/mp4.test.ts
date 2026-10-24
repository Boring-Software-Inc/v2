import { describe, expect, test } from "bun:test";
import { encodeMp4, faststart } from "./mp4";

function box(type: string, body: Uint8Array): Uint8Array {
	const out = new Uint8Array(8 + body.length);
	new DataView(out.buffer).setUint32(0, out.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(body, 8);
	return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

function stco(offsets: number[]): Uint8Array {
	const body = new Uint8Array(8 + offsets.length * 4);
	const view = new DataView(body.buffer);
	view.setUint32(4, offsets.length);
	offsets.forEach((offset, index) => {
		view.setUint32(8 + index * 4, offset);
	});
	return box("stco", body);
}

function topLevel(bytes: Uint8Array): string[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const types: string[] = [];
	for (let at = 0; at < bytes.length; at += view.getUint32(at)) {
		types.push(new TextDecoder().decode(bytes.subarray(at + 4, at + 8)));
	}
	return types;
}

describe("faststart", () => {
	test("moves moov ahead of mdat and shifts chunk offsets", () => {
		const ftyp = box("ftyp", new Uint8Array(8));
		const free = box("free", new Uint8Array(4));
		const mdat = box("mdat", new Uint8Array([1, 2, 3, 4, 5, 6]));
		const chunkAt = ftyp.length + free.length + 8;
		const moov = box(
			"moov",
			box("trak", box("mdia", box("minf", box("stbl", stco([chunkAt]))))),
		);
		const out = faststart(concat(ftyp, free, mdat, moov));
		expect(topLevel(out)).toEqual(["ftyp", "moov", "mdat"]);
		const view = new DataView(out.buffer);
		const stcoAt = ftyp.length + 8 * 5;
		const shifted = view.getUint32(stcoAt + 16);
		expect(out[shifted]).toBe(1);
		expect(out[shifted + 5]).toBe(6);
	});
});

describe("encodeMp4", () => {
	test("encodes rgba frames into a streamable mp4", async () => {
		const width = 64;
		const height = 32;
		const mp4 = await encodeMp4({
			width,
			height,
			fps: 8,
			frames: 8,
			frame: (index) => {
				const pixels = new Uint8Array(width * height * 4).fill(255);
				pixels.fill(0, index * 64, index * 64 + 64);
				return pixels;
			},
		});
		expect(topLevel(mp4)).toEqual(["ftyp", "moov", "mdat"]);
	});
});
