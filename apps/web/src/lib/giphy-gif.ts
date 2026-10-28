import type { CloseGif, GiphyGifRecord } from "@tripwire/contracts";
import { giphyGifSchema, isGiphyMediaUrl } from "@tripwire/contracts";

export type GiphyGif = GiphyGifRecord;

export function allowedRating(rating: GiphyGif["rating"]): boolean {
	return giphyGifSchema.shape.rating.safeParse(rating).success;
}

function mediaUrl(url: string): string {
	const parsed = new URL(url);
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString();
}

export function closeGifFrom(gif: GiphyGif): CloseGif | null {
	const rendition = gif.images.fixed_height;
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
