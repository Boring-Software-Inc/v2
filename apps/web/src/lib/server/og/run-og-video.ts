import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, type RunOgCard } from "#/lib/run-og";
import { FIRE_LOOP_FPS, FIRE_LOOP_FRAMES } from "#/lib/server/og/fire-loop";
import {
	buildGlyphFire,
	type GlyphFire,
	paintGlyphFire,
} from "#/lib/server/og/glyph-fire";
import { encodeMp4 } from "#/lib/server/og/mp4";
import {
	blankRaster,
	decodePng,
	drawOver,
	fillRaster,
	halve,
} from "#/lib/server/og/raster";
import {
	GROUND,
	GUTTER_WIDTH,
	type RunOgAssets,
	renderRunOgOverlay,
} from "#/lib/server/og/render-run-og";

const GUTTER_SCALE = 2;
const fires = new WeakMap<RunOgAssets, GlyphFire>();

function pngBytes(dataUri: string): Uint8Array {
	return Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
}

function glyphFire(assets: RunOgAssets): GlyphFire {
	const cached = fires.get(assets);
	if (cached) {
		return cached;
	}
	const gutters = [assets.fireLeft, assets.fireRight].map((uri) =>
		decodePng(
			pngBytes(uri),
			GUTTER_WIDTH * GUTTER_SCALE,
			OG_IMAGE_HEIGHT * GUTTER_SCALE,
		),
	);
	const fire = buildGlyphFire(gutters);
	fires.set(assets, fire);
	return fire;
}

function groundRgb(): number[] {
	return [1, 3, 5].map((at) => Number.parseInt(GROUND.slice(at, at + 2), 16));
}

export async function runOgVideoFrames(
	card: RunOgCard,
	assets: RunOgAssets,
	avatar: string | null,
) {
	const overlay = await renderRunOgOverlay(card, assets, avatar);
	const fire = glyphFire(assets);
	const ground = fillRaster(
		blankRaster(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT),
		groundRgb(),
	);
	return (index: number): Uint8Array => {
		const frame = { ...ground, pixels: ground.pixels.slice() };
		drawOver(
			frame,
			halve(paintGlyphFire(fire, 0, index, FIRE_LOOP_FRAMES)),
			0,
			0,
		);
		drawOver(
			frame,
			halve(paintGlyphFire(fire, 1, index, FIRE_LOOP_FRAMES)),
			OG_IMAGE_WIDTH - GUTTER_WIDTH,
			0,
		);
		drawOver(frame, overlay, 0, 0);
		return frame.pixels;
	};
}

export async function renderRunOgVideo(
	card: RunOgCard,
	assets: RunOgAssets,
	avatar: string | null,
): Promise<Uint8Array> {
	return await encodeMp4({
		width: OG_IMAGE_WIDTH,
		height: OG_IMAGE_HEIGHT,
		fps: FIRE_LOOP_FPS,
		frames: FIRE_LOOP_FRAMES,
		frame: await runOgVideoFrames(card, assets, avatar),
	});
}
