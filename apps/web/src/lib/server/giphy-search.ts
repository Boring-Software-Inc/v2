import type { GifsResult } from "@giphy/js-fetch-api";
import { validGiphyGifs } from "@tripwire/contracts";
import type { GiphyGif } from "#/lib/giphy-gif";

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
	claim: (key: string) => Promise<boolean>;
	release: (key: string) => Promise<void>;
}

export interface GiphyDeps {
	apiKey: string | null;
	baseUrl: string;
	fetch: (url: string, init?: RequestInit) => Promise<Response>;
	now: () => Date;
	wait: (ms: number) => Promise<void>;
	store: GiphyStore;
}

export const GIPHY_API_BASE = "https://api.giphy.com";
export const GIPHY_PAGE_SIZE = 24;
export const GIPHY_MAX_OFFSET = GIPHY_PAGE_SIZE * 4;
export const GIPHY_MIN_QUERY = 2;
export const GIPHY_MAX_QUERY = 50;
export const GIPHY_RATING = "pg-13";
export const TRENDING_CEILING = 95;
export const SEARCH_CEILING = 75;
export const USER_HOURLY_LIMIT = 15;
export const TRENDING_TTL_MS = 60 * 60 * 1000;
export const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
export const GLOBAL_SCOPE = "global";
export const FILL_LEASE_MS = 10_000;
export const FILL_WAIT_MS = 3000;
export const FILL_POLL_MS = 250;

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

export function cleanResult(raw: unknown, offset: number): GifsResult {
	const body = (raw ?? {}) as {
		data?: unknown;
		pagination?: { total_count?: unknown };
		meta?: GifsResult["meta"];
	};
	const count = Array.isArray(body.data) ? body.data.length : 0;
	const reported = Number(body.pagination?.total_count) || 0;
	const end = offset + count;
	const total =
		end >= GIPHY_MAX_OFFSET + GIPHY_PAGE_SIZE || count < GIPHY_PAGE_SIZE
			? end
			: Math.max(reported, end);
	const meta = body.meta;
	return {
		data: validGiphyGifs(body.data).map((gif) =>
			trimGif(gif as unknown as GiphyGif),
		),
		pagination: { total_count: total, count, offset },
		meta: {
			status: typeof meta?.status === "number" ? meta.status : 200,
			msg: typeof meta?.msg === "string" ? meta.msg : "OK",
			response_id:
				typeof meta?.response_id === "string" ? meta.response_id : "",
		},
	};
}

type Upstream =
	| { kind: "ok"; result: unknown }
	| { kind: "limited" }
	| { kind: "failed" };

async function callGiphy(
	deps: GiphyDeps,
	apiKey: string,
	path: "trending" | "search",
	params: Record<string, string>,
): Promise<Upstream> {
	const url = new URL(`/v1/gifs/${path}`, deps.baseUrl);
	url.search = new URLSearchParams({
		api_key: apiKey,
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
		const body = (await response.json()) as { data?: unknown } | null;
		return Array.isArray(body?.data)
			? { kind: "ok", result: body }
			: { kind: "failed" };
	} catch {
		return { kind: "failed" };
	}
}

function expiry(deps: GiphyDeps, ttl: number): Date {
	return new Date(deps.now().getTime() + ttl);
}

function isFresh(deps: GiphyDeps, entry: GiphyCacheEntry | null): boolean {
	return entry !== null && entry.expiresAt.getTime() > deps.now().getTime();
}

interface FillPlan {
	key: string;
	offset: number;
	ttl: number;
	budgets: [scope: string, limit: number][];
	path: "trending" | "search";
	params: Record<string, string>;
	fallback: (cached: GiphyCacheEntry | null) => Promise<GiphyPage>;
}

async function waitForFill(
	deps: GiphyDeps,
	key: string,
): Promise<GiphyCacheEntry | null> {
	for (let waited = 0; waited < FILL_WAIT_MS; waited += FILL_POLL_MS) {
		await deps.wait(FILL_POLL_MS);
		const entry = await deps.store.read(key);
		if (isFresh(deps, entry)) {
			return entry;
		}
	}
	return null;
}

async function fillPage(deps: GiphyDeps, plan: FillPlan): Promise<GiphyPage> {
	const cached = await deps.store.read(plan.key);
	if (cached && isFresh(deps, cached)) {
		return { result: cached.body, status: "ok" };
	}
	if (!deps.apiKey) {
		const fallback = await plan.fallback(cached);
		return { ...fallback, status: "unavailable" };
	}
	if (!(await deps.store.claim(plan.key))) {
		const filled = await waitForFill(deps, plan.key);
		return filled
			? { result: filled.body, status: "ok" }
			: plan.fallback(cached);
	}
	try {
		const latest = await deps.store.read(plan.key);
		if (latest && isFresh(deps, latest)) {
			return { result: latest.body, status: "ok" };
		}
		for (const [scope, limit] of plan.budgets) {
			if (!(await deps.store.reserve(scope, limit))) {
				return plan.fallback(cached);
			}
		}
		const upstream = await callGiphy(deps, deps.apiKey, plan.path, {
			...plan.params,
			offset: String(plan.offset),
		});
		if (upstream.kind !== "ok") {
			return plan.fallback(cached);
		}
		const result = cleanResult(upstream.result, plan.offset);
		await deps.store.write(plan.key, result, expiry(deps, plan.ttl));
		return { result, status: "ok" };
	} finally {
		await deps.store.release(plan.key);
	}
}

export async function trendingGiphy(
	deps: GiphyDeps,
	input: { offset: number },
): Promise<GiphyPage> {
	const offset = pageOffset(input.offset);
	if (offset > GIPHY_MAX_OFFSET) {
		return { result: emptyResult(offset), status: "ok" };
	}
	return fillPage(deps, {
		key: trendingKey(offset),
		offset,
		ttl: TRENDING_TTL_MS,
		budgets: [[GLOBAL_SCOPE, TRENDING_CEILING]],
		path: "trending",
		params: {},
		fallback: async (cached) => ({
			result: cached?.body ?? emptyResult(offset),
			status: "busy",
		}),
	});
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
	return fillPage(deps, {
		key: searchKey(query, offset),
		offset,
		ttl: SEARCH_TTL_MS,
		budgets: [
			[`user:${input.userId}`, USER_HOURLY_LIMIT],
			[GLOBAL_SCOPE, SEARCH_CEILING],
		],
		path: "search",
		params: { q: query, lang: "en" },
		fallback: async (cached) =>
			cached
				? { result: cached.body, status: "busy" }
				: busyFallback(deps, offset),
	});
}

export function findGif(page: unknown, gifId: string): GiphyGif | null {
	const data = (page as { data?: unknown } | null)?.data;
	const gif = validGiphyGifs(data).find((candidate) => candidate.id === gifId);
	return gif ? (gif as unknown as GiphyGif) : null;
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
		claim: (key) => inner.claim(key),
		release: (key) => inner.release(key),
	};
}
