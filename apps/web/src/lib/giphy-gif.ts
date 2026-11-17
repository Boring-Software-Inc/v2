import type { CloseGif, GiphyGifRecord } from "@tripwire/contracts";
import { closeGifFromGiphy, giphyGifSchema } from "@tripwire/contracts";

export type GiphyGif = GiphyGifRecord;

export function allowedRating(rating: GiphyGif["rating"]): boolean {
	return giphyGifSchema.shape.rating.safeParse(rating).success;
}

export function closeGifFrom(gif: GiphyGif): CloseGif | null {
	if (!allowedRating(gif.rating)) {
		return null;
	}
	return closeGifFromGiphy(gif);
}
