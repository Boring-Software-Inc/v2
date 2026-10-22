import fireLeft from "#/lib/server/og/assets/fire-left.png?inline";
import fireRight from "#/lib/server/og/assets/fire-right.png?inline";
import geistMedium from "#/lib/server/og/assets/Geist-Medium.ttf?inline";
import geistRegular from "#/lib/server/og/assets/Geist-Regular.ttf?inline";
import type { RunOgAssets } from "#/lib/server/og/render-run-og";

function decode(dataUri: string): Buffer {
	return Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
}

export const RUN_OG_ASSETS: RunOgAssets = {
	geistRegular: decode(geistRegular),
	geistMedium: decode(geistMedium),
	fireLeft,
	fireRight,
};
