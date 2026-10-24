import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodePng } from "#/lib/server/og/raster";
import { renderRunOg } from "#/lib/server/og/render-run-og";
import { runOgVideoFrames } from "#/lib/server/og/run-og-video";

const ASSETS_DIR = new URL("./assets/", import.meta.url);

function png(name: string): string {
	return `data:image/png;base64,${readFileSync(new URL(name, ASSETS_DIR)).toString("base64")}`;
}

const assets = {
	geistRegular: readFileSync(new URL("Geist-Regular.ttf", ASSETS_DIR)),
	geistMedium: readFileSync(new URL("Geist-Medium.ttf", ASSETS_DIR)),
	fireLeft: png("fire-left.png"),
	fireRight: png("fire-right.png"),
};

const card = {
	repo: "acme/pub",
	number: 91,
	title: "fix: resolve auth token expiry",
	author: "g-r-i-m",
	avatarUrl: null,
};

function maxDiff(a: Uint8Array, b: Uint8Array, fromX: number, toX: number) {
	let worst = 0;
	for (let y = 0; y < 630; y++) {
		for (let x = fromX; x < toX; x++) {
			for (let c = 0; c < 4; c++) {
				const i = (y * 1200 + x) * 4 + c;
				worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
			}
		}
	}
	return worst;
}

describe("runOgVideoFrames", () => {
	test("every frame keeps the still card between the gutters", async () => {
		const still = decodePng(await renderRunOg(card, assets, null), 1200, 630);
		const frame = await runOgVideoFrames(card, assets, null);
		for (const index of [0, 17, 40]) {
			expect(
				maxDiff(frame(index), still.pixels, 132, 1068),
			).toBeLessThanOrEqual(1);
		}
	});

	test("the gutters move", async () => {
		const frame = await runOgVideoFrames(card, assets, null);
		expect(maxDiff(frame(0), frame(8), 0, 120)).toBeGreaterThan(100);
	});
});
