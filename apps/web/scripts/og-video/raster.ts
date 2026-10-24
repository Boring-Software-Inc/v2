import { Resvg } from "@resvg/resvg-js";

export interface Raster {
	width: number;
	height: number;
	pixels: Uint8Array;
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
