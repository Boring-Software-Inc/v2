import { deflateSync } from "node:zlib";

/**
 * A dependency-free PNG encoder + sparkline renderer, for the economics digest
 * thumbnail (Discord won't render SVG in an image slot, and our spend figures
 * must not transit an external chart service). The PNG is hand-assembled —
 * 8-bit RGBA, filter 0 per scanline — and the IDAT is compressed with
 * `node:zlib` (portable across the Bun worker and the Node web runtime). The
 * canvas is small and plotted pixel-wise; the hard edges suit the dither look.
 * Pure: series in, PNG bytes out.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
	return new Uint8Array([
		(n >>> 24) & 255,
		(n >>> 16) & 255,
		(n >>> 8) & 255,
		n & 255,
	]);
}

function concat(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}

/** One PNG chunk: length, type+data (CRC covers both), CRC32. */
function chunk(type: string, data: Uint8Array): Uint8Array {
	const typeBytes = new Uint8Array(4);
	for (let i = 0; i < 4; i++) {
		typeBytes[i] = type.charCodeAt(i);
	}
	const body = concat([typeBytes, data]);
	return concat([u32(data.length), body, u32(crc32(body))]);
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** Encode an 8-bit RGBA pixel buffer (row-major) as PNG bytes. */
export function encodePng(
	width: number,
	height: number,
	rgba: Uint8Array,
): Uint8Array {
	const ihdr = concat([
		u32(width),
		u32(height),
		new Uint8Array([8, 6, 0, 0, 0]), // bit depth 8, color type 6 (RGBA), no interlace
	]);
	const stride = width * 4;
	// Prefix each scanline with filter byte 0 (none), the only filter we emit.
	const raw = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}
	const idat = new Uint8Array(deflateSync(raw));
	return concat([
		PNG_SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", idat),
		chunk("IEND", new Uint8Array(0)),
	]);
}

export type Rgb = [number, number, number];
export interface SparkSeries {
	values: number[];
	color: Rgb;
}

export interface SparklineOptions {
	width?: number;
	height?: number;
	/** Canvas fill (RGBA). Defaults to Discord's embed background, opaque. */
	background?: [number, number, number, number];
	padding?: number;
	/** Line half-thickness in pixels (0 = 1px, 1 = 3px). */
	thickness?: number;
}

/**
 * Render one or more series as overlaid sparklines on a shared vertical scale
 * (so lines are directly comparable) and return PNG bytes. A single point or a
 * flat series draws a straight baseline; an empty series is skipped.
 */
export function renderSparklinePng(
	series: SparkSeries[],
	options: SparklineOptions = {},
): Uint8Array {
	const width = options.width ?? 360;
	const height = options.height ?? 120;
	const pad = options.padding ?? 10;
	const thick = options.thickness ?? 1;
	const bg = options.background ?? [43, 45, 49, 255];

	const rgba = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		rgba[i * 4] = bg[0];
		rgba[i * 4 + 1] = bg[1];
		rgba[i * 4 + 2] = bg[2];
		rgba[i * 4 + 3] = bg[3];
	}

	const plot = (x: number, y: number, color: Rgb) => {
		for (let dy = -thick; dy <= thick; dy++) {
			for (let dx = -thick; dx <= thick; dx++) {
				const px = x + dx;
				const py = y + dy;
				if (px < 0 || px >= width || py < 0 || py >= height) {
					continue;
				}
				const o = (py * width + px) * 4;
				rgba[o] = color[0];
				rgba[o + 1] = color[1];
				rgba[o + 2] = color[2];
				rgba[o + 3] = 255;
			}
		}
	};

	const line = (x0: number, y0: number, x1: number, y1: number, color: Rgb) => {
		// Sample the segment finely enough that no gaps appear at any slope.
		const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
		for (let s = 0; s <= steps; s++) {
			const t = s / steps;
			plot(
				Math.round(x0 + (x1 - x0) * t),
				Math.round(y0 + (y1 - y0) * t),
				color,
			);
		}
	};

	// Shared scale across every series so billed and actual sit on one axis.
	const all = series.flatMap((s) => s.values);
	const min = all.length ? Math.min(...all) : 0;
	const max = all.length ? Math.max(...all) : 1;
	const span = max - min || 1;
	const innerW = width - pad * 2;
	const innerH = height - pad * 2;

	for (const s of series) {
		if (s.values.length === 0) {
			continue;
		}
		const stepX = s.values.length > 1 ? innerW / (s.values.length - 1) : 0;
		const pointFor = (i: number, v: number): [number, number] => [
			pad + i * stepX,
			pad + innerH - ((v - min) / span) * innerH,
		];
		let [px, py] = pointFor(0, s.values[0] as number);
		if (s.values.length === 1) {
			plot(Math.round(px), Math.round(py), s.color);
			continue;
		}
		for (let i = 1; i < s.values.length; i++) {
			const [x, y] = pointFor(i, s.values[i] as number);
			line(
				Math.round(px),
				Math.round(py),
				Math.round(x),
				Math.round(y),
				s.color,
			);
			px = x;
			py = y;
		}
	}

	return encodePng(width, height, rgba);
}

// The 4×4 ordered (Bayer) matrix, normalized to 0–1 thresholds — the exact
// matrix the dither-kit charts paint with, ported here for the server render.
const BAYER = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));
/** Alpha of a dither "off" cell relative to an "on" cell — the scatter modulates
 * between two tiers of the same color rather than leaving holes. */
const OFF_TIER = 0.4;
/** The value-line border sits just under solid so it reads as a soft edge. */
const BORDER_ALPHA = 0.72;

/** Linear-resample a per-index array to `cols` columns (dither-kit's resample). */
function resample(src: number[], cols: number): number[] {
	const out = new Array<number>(cols);
	const last = Math.max(src.length - 1, 1);
	for (let c = 0; c < cols; c++) {
		const t = (c / Math.max(cols - 1, 1)) * last;
		const i = Math.floor(t);
		const f = t - i;
		const a = src[i] ?? 0;
		const b = src[Math.min(i + 1, src.length - 1)] ?? a;
		out[c] = a + (b - a) * f;
	}
	return out;
}

export interface DitherChartOptions extends SparklineOptions {
	/** Backing-pixel size: bigger = chunkier dither. Defaults to 3. */
	cell?: number;
}

/**
 * Render series as overlaid ordered-dither AREA charts — the dither-kit look,
 * server-side. Each column fills from its value line down to the floor with the
 * Bayer scatter (dense at the floor, dissolving up to a soft value-line border),
 * varying only the color's alpha so it reads on any background. Painted into a
 * low-res backing buffer, then nearest-neighbor upscaled so the cells stay chunky
 * and pixelated. Series paint in order; the last (front) layer is thinned so the
 * one behind shows through. Pure: series in, PNG bytes out.
 */
export function renderDitherChart(
	series: SparkSeries[],
	options: DitherChartOptions = {},
): Uint8Array {
	const width = options.width ?? 480;
	const height = options.height ?? 160;
	const cell = options.cell ?? 3;
	const bg = options.background ?? [43, 45, 49, 255];
	const bw = Math.max(8, Math.floor(width / cell));
	const bh = Math.max(8, Math.floor(height / cell));
	const pad = Math.max(1, Math.round((options.padding ?? cell * 3) / cell));

	const back = new Uint8Array(bw * bh * 4);
	for (let i = 0; i < bw * bh; i++) {
		back[i * 4] = bg[0];
		back[i * 4 + 1] = bg[1];
		back[i * 4 + 2] = bg[2];
		back[i * 4 + 3] = bg[3];
	}
	const blend = (x: number, y: number, color: Rgb, a: number) => {
		if (x < 0 || x >= bw || y < 0 || y >= bh) {
			return;
		}
		const o = (y * bw + x) * 4;
		const inv = 1 - a;
		back[o] = Math.round((back[o] as number) * inv + color[0] * a);
		back[o + 1] = Math.round((back[o + 1] as number) * inv + color[1] * a);
		back[o + 2] = Math.round((back[o + 2] as number) * inv + color[2] * a);
		back[o + 3] = 255;
	};

	const all = series.flatMap((s) => s.values);
	const min = all.length ? Math.min(...all) : 0;
	const max = all.length ? Math.max(...all) : 1;
	const span = max - min || 1;
	const innerW = bw - pad * 2;
	const innerH = bh - pad * 2;
	const floor = bh - pad;

	series.forEach((s, si) => {
		if (s.values.length === 0) {
			return;
		}
		const cols = resample(s.values, innerW);
		// Thin the front layer so the one behind reads through its "off" cells.
		const sparse = si === series.length - 1 && series.length > 1 ? 0.2 : 0;
		for (let cx = 0; cx < innerW; cx++) {
			const x = pad + cx;
			const top = Math.round(
				pad + innerH - (((cols[cx] as number) - min) / span) * innerH,
			);
			const depth = floor - top;
			for (let y = top; y < floor; y++) {
				const density = depth > 0 ? (y - top) / depth : 1;
				const lit = density > (BAYER[y & 3]?.[x & 3] as number) + sparse;
				const k = 0.3 + density * 0.7;
				blend(x, y, s.color, lit ? k : k * OFF_TIER);
			}
			blend(x, top, s.color, BORDER_ALPHA); // soft value-line edge
		}
	});

	// Nearest-neighbor upscale: each backing cell becomes a cell×cell block, so
	// the dither stays crisp and pixelated instead of smoothing away.
	const rgba = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const by = Math.min(bh - 1, Math.floor(y / cell));
		for (let x = 0; x < width; x++) {
			const bx = Math.min(bw - 1, Math.floor(x / cell));
			const s = (by * bw + bx) * 4;
			const d = (y * width + x) * 4;
			rgba[d] = back[s] as number;
			rgba[d + 1] = back[s + 1] as number;
			rgba[d + 2] = back[s + 2] as number;
			rgba[d + 3] = back[s + 3] as number;
		}
	}
	return encodePng(width, height, rgba);
}
