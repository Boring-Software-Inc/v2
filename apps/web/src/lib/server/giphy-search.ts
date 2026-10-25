import type { GifsResult } from "@giphy/js-fetch-api";
import { allowedRating, type GiphyGif } from "#/lib/giphy-gif";
export type GiphyStatus = "ok" | "busy" | "unavailable";

export interface GiphyPage {
	result: GifsResult;
	status: GiphyStatus;
}

export interface GiphyCacheEntry {
	body: GifsResult;
	expiresAt: Date;
}

export interface GiphyStore {
	read: (key: string) => Promise<GiphyCacheEntry | null>;
	write: (key: string, body: GifsResult, expiresAt: Date) => Promise<void>;
	reserve: (scope: string, limit: number) => Promise<boolean>;
}

export interface GiphyDeps {
	apiKey: string | null;
	baseUrl: string;
	fetch: (url: string, init?: RequestInit) => Promise<Response>;
	now: () => Date;
	store: GiphyStore;
}

export const GIPHY_API_BASE = "https://api.giphy.com";
export const GIPHY_PAGE_SIZE = 24;
export const GIPHY_MAX_OFFSET = GIPHY_PAGE_SIZE * 4;
export const GIPHY_MIN_QUERY = 2;
export const GIPHY_MAX_QUERY = 50;
export const GIPHY_RATING = "pg-13";
export const GIPHY_HOURLY_LIMIT = 100;
export const TRENDING_CEILING = 95;
export const SEARCH_CEILING = 75;
export const USER_HOURLY_LIMIT = 15;
export const TRENDING_TTL_MS = 60 * 60 * 1000;
export const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
export const GLOBAL_SCOPE = "global";

const KEPT_RENDITIONS = [
	"original",
	"original_still",
	"fixed_width",
	"fixed_width_still",
	"fixed_height",
	"fixed_height_still",
	"fixed_width_small",
	"fixed_width_small_still",
	"fixed_height_small",
	"fixed_height_small_still",
] as const;

export function normalizeQuery(query: string): string {
	return query
		.normalize("NFKC")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, GIPHY_MAX_QUERY);
}

export function pageOffset(offset: number): number {
	if (!Number.isFinite(offset) || offset <= 0) {
		return 0;
	}
	return Math.floor(offset / GIPHY_PAGE_SIZE) * GIPHY_PAGE_SIZE;
}

export function searchKey(query: string, offset: number): string {
	return `search:${offset}:${query}`;
}

export function trendingKey(offset: number): string {
	return `trending:${offset}`;
}

function emptyResult(offset: number): GifsResult {
	return {
		data: [],
		pagination: { total_count: offset, count: 0, offset },
		meta: { status: 200, msg: "OK", response_id: "" },
	};
}

function finalPage(result: GifsResult): GifsResult {
	const count = result.data.length;
	return {
		...result,
		pagination: { total_count: count, count, offset: 0 },
	};
}

function trimGif(gif: GiphyGif): GiphyGif {
	const images: Record<string, unknown> = {};
	const source = gif.images as unknown as Record<string, unknown>;
	for (const name of KEPT_RENDITIONS) {
		if (source[name]) {
			images[name] = source[name];
		}
	}
	const { user: _user, ...rest } = gif as GiphyGif & {
		analytics?: unknown;
	};
	const trimmed: Record<string, unknown> = {
		...rest,
		images,
		analytics_response_payload: "",
	};
	delete trimmed.analytics;
	return trimmed as unknown as GiphyGif;
}

export function cleanResult(raw: GifsResult, offset: number): GifsResult {
	const data = (raw.data ?? []).filter((gif) => allowedRating(gif.rating));
	const reported = raw.pagination ?? {
		total_count: offset,
		count: 0,
		offset,
	};
	const count = raw.data?.length ?? 0;
	const end = offset + count;
	const total =
		end >= GIPHY_MAX_OFFSET + GIPHY_PAGE_SIZE || count < GIPHY_PAGE_SIZE
			? end
			: Math.max(reported.total_count, end);
	return {
		data: data.map(trimGif),
		pagination: { total_count: total, count, offset },
		meta: raw.meta ?? { status: 200, msg: "OK", response_id: "" },
	};
}

type Upstream =
	| { kind: "ok"; result: GifsResult }
	| { kind: "limited" }
	| { kind: "failed" };

async function callGiphy(
	deps: GiphyDeps,
	path: "trending" | "search",
	params: Record<string, string>,
): Promise<Upstream> {
	if (!deps.apiKey) {
		return { kind: "failed" };
	}
	const url = new URL(`/v1/gifs/${path}`, deps.baseUrl);
	url.search = new URLSearchParams({
		api_key: deps.apiKey,
		limit: String(GIPHY_PAGE_SIZE),
		rating: GIPHY_RATING,
		...params,
	}).toString();
	try {
		const response = await deps.fetch(url.toString(), {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(5000),
		});
		if (response.status === 429) {
			return { kind: "limited" };
		}
		if (!response.ok) {
			return { kind: "failed" };
		}
		return { kind: "ok", result: (await response.json()) as GifsResult };
	} catch {
		return { kind: "failed" };
	}
}

function expiry(deps: GiphyDeps, ttl: number): Date {
	return new Date(deps.now().getTime() + ttl);
}

function isFresh(deps: GiphyDeps, entry: GiphyCacheEntry): boolean {
	return entry.expiresAt.getTime() > deps.now().getTime();
}

export async function trendingGiphy(
	deps: GiphyDeps,
	input: { offset: number },
): Promise<GiphyPage> {
	const offset = pageOffset(input.offset);
	if (offset > GIPHY_MAX_OFFSET) {
		return { result: emptyResult(offset), status: "ok" };
	}
	const key = trendingKey(offset);
	const cached = await deps.store.read(key);
	if (cached && isFresh(deps, cached)) {
		return { result: cached.body, status: "ok" };
	}
	const stale = (status: GiphyStatus): GiphyPage => ({
		result: cached?.body ?? emptyResult(offset),
		status,
	});
	if (!(await deps.store.reserve(GLOBAL_SCOPE, TRENDING_CEILING))) {
		return stale("busy");
	}
	const upstream = await callGiphy(deps, "trending", {
		offset: String(offset),
	});
	if (upstream.kind === "limited") {
		return stale("busy");
	}
	if (upstream.kind === "failed") {
		return stale(cached ? "busy" : "unavailable");
	}
	const result = cleanResult(upstream.result, offset);
	await deps.store.write(key, result, expiry(deps, TRENDING_TTL_MS));
	return { result, status: "ok" };
}

async function busyFallback(
	deps: GiphyDeps,
	offset: number,
): Promise<GiphyPage> {
	if (offset > 0) {
		return { result: emptyResult(offset), status: "busy" };
	}
	const trending = await deps.store.read(trendingKey(0));
	return {
		result: trending ? finalPage(trending.body) : emptyResult(0),
		status: "busy",
	};
}

export async function searchGiphy(
	deps: GiphyDeps,
	input: { userId: string; query: string; offset: number },
): Promise<GiphyPage> {
	const query = normalizeQuery(input.query);
	if (query.length < GIPHY_MIN_QUERY) {
		return trendingGiphy(deps, { offset: input.offset });
	}
	const offset = pageOffset(input.offset);
	if (offset > GIPHY_MAX_OFFSET) {
		return { result: emptyResult(offset), status: "ok" };
	}
	const key = searchKey(query, offset);
	const cached = await deps.store.read(key);
	if (cached && isFresh(deps, cached)) {
		return { result: cached.body, status: "ok" };
	}
	if (!(await deps.store.reserve(`user:${input.userId}`, USER_HOURLY_LIMIT))) {
		return busyFallback(deps, offset);
	}
	if (!(await deps.store.reserve(GLOBAL_SCOPE, SEARCH_CEILING))) {
		return busyFallback(deps, offset);
	}
	const upstream = await callGiphy(deps, "search", {
		q: query,
		offset: String(offset),
		lang: "en",
	});
	if (upstream.kind !== "ok") {
		return cached
			? { result: cached.body, status: "busy" }
			: busyFallback(deps, offset);
	}
	const result = cleanResult(upstream.result, offset);
	await deps.store.write(key, result, expiry(deps, SEARCH_TTL_MS));
	return { result, status: "ok" };
}

export function findGif(page: unknown, gifId: string): GiphyGif | null {
	const data = (page as { data?: unknown } | null)?.data;
	if (!Array.isArray(data)) {
		return null;
	}
	return (data as GiphyGif[]).find((gif) => String(gif.id) === gifId) ?? null;
}

export interface MemoryCacheOptions {
	maxEntries: number;
	now: () => Date;
}

export function createMemoryLayer(
	inner: GiphyStore,
	options: MemoryCacheOptions,
): GiphyStore {
	const entries = new Map<string, GiphyCacheEntry>();
	const remember = (key: string, entry: GiphyCacheEntry) => {
		entries.delete(key);
		entries.set(key, entry);
		while (entries.size > options.maxEntries) {
			const oldest = entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			entries.delete(oldest);
		}
	};
	return {
		read: async (key) => {
			const hit = entries.get(key);
			if (hit && hit.expiresAt.getTime() > options.now().getTime()) {
				return hit;
			}
			const stored = await inner.read(key);
			if (stored) {
				remember(key, stored);
			}
			return stored;
		},
		write: async (key, body, expiresAt) => {
			remember(key, { body, expiresAt });
			await inner.write(key, body, expiresAt);
		},
		reserve: (scope, limit) => inner.reserve(scope, limit),
	};
}
