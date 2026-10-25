import type { GifsResult } from "@giphy/js-fetch-api";
import type { CloseGif } from "@tripwire/contracts";
import { closeGifFrom } from "#/lib/giphy-gif";
import {
	createMemoryLayer,
	findGif,
	GIPHY_API_BASE,
	type GiphyDeps,
	type GiphyStore,
} from "#/lib/server/giphy-search";

let layered: GiphyStore | null = null;

async function databaseStore(): Promise<GiphyStore> {
	const { giphyServices } = await import("@tripwire/db");
	const { getDb } = await import("#/lib/server/db");
	const db = getDb().db;
	return {
		read: async (key) => {
			const entry = await giphyServices.readGiphyCache(db, key);
			return entry
				? { body: entry.body as GifsResult, expiresAt: entry.expiresAt }
				: null;
		},
		write: (key, body, expiresAt) =>
			giphyServices.writeGiphyCache(db, key, body, expiresAt),
		reserve: (scope, limit) => giphyServices.reserveGiphyCall(db, scope, limit),
	};
}

export async function giphyDeps(): Promise<GiphyDeps> {
	if (!layered) {
		layered = createMemoryLayer(await databaseStore(), {
			maxEntries: 200,
			now: () => new Date(),
		});
	}
	return {
		apiKey: process.env.GIPHY_API_KEY?.trim() || null,
		baseUrl: process.env.GIPHY_API_BASE || GIPHY_API_BASE,
		fetch: (url, init) => fetch(url, init),
		now: () => new Date(),
		store: layered,
	};
}

export async function resolveServedGif(
	gifId: string,
): Promise<CloseGif | null> {
	const { giphyServices } = await import("@tripwire/db");
	const { getDb } = await import("#/lib/server/db");
	const page = await giphyServices.findCachedGiphyPage(getDb().db, gifId);
	const gif = findGif(page, gifId);
	return gif ? closeGifFrom(gif) : null;
}
