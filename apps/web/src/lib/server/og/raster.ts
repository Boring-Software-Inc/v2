import { Resvg } from "@resvg/resvg-js";

export interface Raster {
	width: number;
	height: number;
	pixels: Uint8Array;
}

export function blankRaster(width: number, height: number): Raster {
	return { width, height, pixels: new Uint8Array(width * height * 4) };
}

export function fillRaster(raster: Raster, [r, g, b]: number[]): Raster {
	const { pixels } = raster;
	for (let i = 0; i < pixels.length; i += 4) {
		pixels[i] = r ?? 0;
		pixels[i + 1] = g ?? 0;
		pixels[i + 2] = b ?? 0;
		pixels[i + 3] = 255;
	}
	return raster;
}

export function rasterFromSvg(svg: string): Raster {
	const image = new Resvg(svg, { fitTo: { mode: "original" } }).render();
	return {
		width: image.width,
		height: image.height,
		pixels: new Uint8Array(image.pixels),
	};
}

export function decodePng(png: Uint8Array, width: number, height: number) {
	const href = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
	return rasterFromSvg(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" image-rendering="optimizeSpeed" href="${href}"/></svg>`,
	);
}

export function drawOver(
	target: Raster,
	source: Raster,
	left: number,
	top: number,
): void {
	const dst = target.pixels;
	const src = source.pixels;
	for (let y = 0; y < source.height; y++) {
		const ty = top + y;
		if (ty < 0 || ty >= target.height) {
			continue;
		}
		for (let x = 0; x < source.width; x++) {
			const tx = left + x;
			if (tx < 0 || tx >= target.width) {
				continue;
			}
			const s = (y * source.width + x) * 4;
			const alpha = src[s + 3] ?? 0;
			if (alpha === 0) {
				continue;
			}
			const d = (ty * target.width + tx) * 4;
			const keep = 255 - alpha;
			for (let c = 0; c < 4; c++) {
				dst[d + c] =
					(src[s + c] ?? 0) + Math.round(((dst[d + c] ?? 0) * keep) / 255);
			}
		}
	}
}

export function halve(source: Raster): Raster {
	const width = source.width >> 1;
	const height = source.height >> 1;
	const out = blankRaster(width, height);
	const src = source.pixels;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const a = (2 * y * source.width + 2 * x) * 4;
			const b = a + source.width * 4;
			const o = (y * width + x) * 4;
			for (let c = 0; c < 4; c++) {
				out.pixels[o + c] =
					((src[a + c] ?? 0) +
						(src[a + 4 + c] ?? 0) +
						(src[b + c] ?? 0) +
						(src[b + 4 + c] ?? 0) +
						2) >>
					2;
			}
		}
	}
	return out;
}
