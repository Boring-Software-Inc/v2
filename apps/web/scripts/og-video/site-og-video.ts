import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from "#/lib/run-og";
import {
	FIRE_LOOP_FPS,
	FIRE_LOOP_FRAMES,
	type FireField,
	fireFieldFromLevels,
	fireFrameLevels,
} from "./fire-loop";
import { encodeMp4 } from "./mp4";
import { decodePng, type Raster } from "./raster";

const CELL = 5;
const FIELD_SCALE = 2;
const COVER_TOLERANCE = 24;
const APP_WINDOW = { left: 329, top: 299 };
const BLOCK_COLORS = [
	[251, 211, 184],
	[249, 115, 22],
	[232, 70, 28],
];
const MAX_LEVEL = BLOCK_COLORS.length;

function blockLevel(field: Raster, col: number, row: number): number {
	const scale = CELL * FIELD_SCALE;
	const x = col * scale + (scale >> 1);
	const y = row * scale + (scale >> 1);
	const i = (y * field.width + x) * 4;
	if ((field.pixels[i + 3] ?? 0) < 128) {
		return 0;
	}
	const green = field.pixels[i + 1] ?? 0;
	return green > 200 ? 1 : green > 100 ? 2 : 3;
}

function readField(field: Raster): FireField {
	const cols = OG_IMAGE_WIDTH / CELL;
	const rows = Math.ceil(OG_IMAGE_HEIGHT / CELL);
	const levels = new Uint8Array(cols * rows);
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			levels[row * cols + col] = blockLevel(field, col, row);
		}
	}
	return fireFieldFromLevels(levels, cols, rows, MAX_LEVEL);
}

function near(pixels: Uint8Array, at: number, color: number[]): boolean {
	return color.every(
		(value, c) => Math.abs((pixels[at + c] ?? 0) - value) <= COVER_TOLERANCE,
	);
}

function splitFire(image: Raster) {
	const ground = [...image.pixels.subarray(0, 3)];
	const backdrop = image.pixels.slice();
	const covered = new Uint8Array(image.width * image.height);
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			const at = y * image.width + x;
			const inWindow = x >= APP_WINDOW.left && y >= APP_WINDOW.top;
			if (inWindow || near(image.pixels, at * 4, ground)) {
				covered[at] = inWindow ? 1 : 0;
				continue;
			}
			if (BLOCK_COLORS.some((color) => near(image.pixels, at * 4, color))) {
				backdrop.set(ground, at * 4);
			} else {
				covered[at] = 1;
			}
		}
	}
	const grown = covered.slice();
	for (let y = 1; y < image.height - 1; y++) {
		for (let x = 1; x < image.width - 1; x++) {
			const at = y * image.width + x;
			if (
				covered[at - 1] ||
				covered[at + 1] ||
				covered[at - image.width] ||
				covered[at + image.width]
			) {
				grown[at] = 1;
			}
		}
	}
	return { backdrop, covered: grown };
}

export function siteOgFrames(ogPng: Uint8Array, fieldPng: Uint8Array) {
	const image = decodePng(ogPng, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT);
	const field = decodePng(
		fieldPng,
		OG_IMAGE_WIDTH * FIELD_SCALE,
		OG_IMAGE_HEIGHT * FIELD_SCALE,
	);
	const fire = readField(field);
	const { backdrop, covered } = splitFire(image);
	return (index: number): Uint8Array => {
		const frame = backdrop.slice();
		const current = fireFrameLevels(fire, index / FIRE_LOOP_FRAMES, MAX_LEVEL);
		for (let y = 0; y < image.height; y++) {
			for (let x = 0; x < image.width; x++) {
				const at = y * image.width + x;
				const level =
					current[((y / CELL) | 0) * fire.cols + ((x / CELL) | 0)] ?? 0;
				const color = BLOCK_COLORS[level - 1];
				if (color && !covered[at]) {
					frame.set(color, at * 4);
				}
			}
		}
		return frame;
	};
}

export async function renderSiteOgVideo(
	ogPng: Uint8Array,
	fieldPng: Uint8Array,
): Promise<Uint8Array> {
	return await encodeMp4({
		width: OG_IMAGE_WIDTH,
		height: OG_IMAGE_HEIGHT,
		fps: FIRE_LOOP_FPS,
		frames: FIRE_LOOP_FRAMES,
		frame: siteOgFrames(ogPng, fieldPng),
	});
}
