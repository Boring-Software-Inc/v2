import type { GifsResult } from "@giphy/js-fetch-api";
import type { CloseGif } from "@tripwire/contracts";
import { isGiphyMediaUrl } from "@tripwire/contracts";

export type GiphyGif = GifsResult["data"][number];

const ALLOWED_RATINGS = new Set(["y", "g", "pg", "pg-13"]);

export function allowedRating(rating: unknown): boolean {
	return typeof rating === "string" && ALLOWED_RATINGS.has(rating);
}

function mediaUrl(url: string): string {
	const parsed = new URL(url);
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString();
}

export function closeGifFrom(gif: GiphyGif): CloseGif | null {
	const rendition = (gif.images as unknown as Record<string, unknown>)
		.fixed_height as
		| { url?: string; width?: unknown; height?: unknown }
		| undefined;
	if (!rendition?.url || !isGiphyMediaUrl(rendition.url)) {
		return null;
	}
	if (!allowedRating(gif.rating)) {
		return null;
	}
	const width = Number(rendition.width);
	const height = Number(rendition.height);
	if (!Number.isInteger(width) || !Number.isInteger(height)) {
		return null;
	}
	if (width < 1 || height < 1 || width > 2000 || height > 2000) {
		return null;
	}
	return {
		id: String(gif.id),
		url: mediaUrl(rendition.url),
		width,
		height,
		title: (gif.title ?? "").slice(0, 200),
	};
}
