import { createH264MP4Encoder } from "h264-mp4-encoder";

export interface Mp4Clip {
	width: number;
	height: number;
	fps: number;
	frames: number;
	frame: (index: number) => Uint8Array;
}

const QUANTIZER = 28;

export async function encodeMp4(clip: Mp4Clip): Promise<Uint8Array> {
	const encoder = await createH264MP4Encoder();
	const name = "og.mp4";
	try {
		encoder.outputFilename = name;
		encoder.width = clip.width;
		encoder.height = clip.height;
		encoder.frameRate = clip.fps;
		encoder.quantizationParameter = QUANTIZER;
		encoder.groupOfPictures = clip.frames;
		encoder.speed = 10;
		encoder.initialize();
		for (let index = 0; index < clip.frames; index++) {
			encoder.addFrameRgba(clip.frame(index));
		}
		encoder.finalize();
		const bytes = encoder.FS.readFile(name);
		encoder.FS.unlink(name);
		return faststart(bytes);
	} finally {
		encoder.delete();
	}
}

interface Box {
	type: string;
	start: number;
	size: number;
}

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

function readBoxes(bytes: Uint8Array, from: number, to: number): Box[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const boxes: Box[] = [];
	let offset = from;
	while (offset + 8 <= to) {
		const size = view.getUint32(offset);
		if (size < 8 || offset + size > to) {
			throw new Error("mp4: malformed box");
		}
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		boxes.push({ type, start: offset, size });
		offset += size;
	}
	return boxes;
}

function shiftChunkOffsets(moov: Uint8Array, delta: number): void {
	const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
	const walk = (from: number, to: number) => {
		for (const box of readBoxes(moov, from, to)) {
			if (CONTAINERS.has(box.type)) {
				walk(box.start + 8, box.start + box.size);
			} else if (box.type === "stco" || box.type === "co64") {
				const wide = box.type === "co64";
				const count = view.getUint32(box.start + 12);
				for (let index = 0; index < count; index++) {
					const at = box.start + 16 + index * (wide ? 8 : 4);
					if (wide) {
						view.setBigUint64(at, view.getBigUint64(at) + BigInt(delta));
					} else {
						view.setUint32(at, view.getUint32(at) + delta);
					}
				}
			}
		}
	};
	walk(8, moov.byteLength);
}

export function faststart(bytes: Uint8Array): Uint8Array {
	const boxes = readBoxes(bytes, 0, bytes.byteLength);
	const ftyp = boxes.find((box) => box.type === "ftyp");
	const moov = boxes.find((box) => box.type === "moov");
	const mdat = boxes.find((box) => box.type === "mdat");
	if (!(ftyp && moov && mdat)) {
		throw new Error("mp4: missing ftyp, moov or mdat");
	}
	const slice = (box: Box) => bytes.slice(box.start, box.start + box.size);
	const head = slice(moov);
	const mdatStart = ftyp.size + moov.size;
	shiftChunkOffsets(head, mdatStart - mdat.start);
	const out = new Uint8Array(ftyp.size + moov.size + mdat.size);
	out.set(slice(ftyp), 0);
	out.set(head, ftyp.size);
	out.set(slice(mdat), mdatStart);
	return out;
}
