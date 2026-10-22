import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderRunOg } from "#/lib/server/og/render-run-og";

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

describe("renderRunOg", () => {
	test("renders a 1200x630 png", async () => {
		const out = await renderRunOg(
			{
				repo: "acme/pub",
				number: 91,
				title: "fix: resolve auth token expiry",
				author: "g-r-i-m",
				avatarUrl: null,
			},
			assets,
			null,
		);
		const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
		expect([...out.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
		expect(view.getUint32(16)).toBe(1200);
		expect(view.getUint32(20)).toBe(630);
	});
});
