import { describe, expect, test } from "bun:test";
import type { GifsResult } from "@giphy/js-fetch-api";
import { closeGifFrom, type GiphyGif } from "#/lib/giphy-gif";
import {
	createMemoryLayer,
	findGif,
	GIPHY_MAX_OFFSET,
	GIPHY_PAGE_SIZE,
	type GiphyCacheEntry,
	type GiphyDeps,
	type GiphyStore,
	normalizeQuery,
	SEARCH_CEILING,
	SEARCH_TTL_MS,
	searchGiphy,
	TRENDING_CEILING,
	TRENDING_TTL_MS,
	trendingGiphy,
	USER_HOURLY_LIMIT,
} from "#/lib/server/giphy-search";

const START = new Date("2026-10-25T10:00:00.000Z");

function gif(id: string, rating = "g"): GiphyGif {
	return {
		id,
		rating,
		title: `${id} GIF`,
		type: "gif",
		analytics_response_payload: "e=secret",
		analytics: { onload: { url: "x" } },
		user: { username: "someone" },
		images: {
			fixed_height: {
				url: `https://media2.giphy.com/media/${id}/200.gif?cid=abc&rid=200.gif`,
				width: "356",
				height: "200",
			},
			fixed_width: {
				url: `https://media2.giphy.com/media/${id}/200w.gif`,
				width: "200",
				height: "112",
			},
			downsized_large: { url: "https://media2.giphy.com/big.gif" },
		},
	} as unknown as GiphyGif;
}

function page(ids: string[], offset = 0, rating = "g"): GifsResult {
	return {
		data: ids.map((id) => gif(id, rating)),
		pagination: { total_count: 5000, count: ids.length, offset },
		meta: { status: 200, msg: "OK", response_id: "r" },
	};
}

function fullPage(prefix: string, offset = 0): GifsResult {
	return page(
		Array.from({ length: GIPHY_PAGE_SIZE }, (_, i) => `${prefix}${i}`),
		offset,
	);
}

class FakeStore implements GiphyStore {
	entries = new Map<string, GiphyCacheEntry>();
	counts = new Map<string, number>();
	reads = 0;
	async read(key: string) {
		this.reads++;
		return this.entries.get(key) ?? null;
	}
	async write(key: string, body: GifsResult, expiresAt: Date) {
		this.entries.set(key, { body, expiresAt });
	}
	async reserve(scope: string, limit: number) {
		const used = this.counts.get(scope) ?? 0;
		if (used + 1 > limit) {
			return false;
		}
		this.counts.set(scope, used + 1);
		return true;
	}
}

interface Harness {
	deps: GiphyDeps;
	store: FakeStore;
	calls: URL[];
	setNow: (ms: number) => void;
	respond: (fn: (url: URL) => Response) => void;
}

function harness(apiKey: string | null = "test-key"): Harness {
	const store = new FakeStore();
	const calls: URL[] = [];
	let now = START.getTime();
	let responder = (url: URL) =>
		Response.json(
			url.pathname.endsWith("/trending")
				? fullPage("t", Number(url.searchParams.get("offset")))
				: fullPage(
						`${url.searchParams.get("q")}-`,
						Number(url.searchParams.get("offset")),
					),
		);
	return {
		store,
		calls,
		setNow: (ms) => {
			now = START.getTime() + ms;
		},
		respond: (fn) => {
			responder = fn;
		},
		deps: {
			apiKey,
			baseUrl: "https://api.giphy.test",
			now: () => new Date(now),
			store,
			fetch: async (input) => {
				const url = new URL(input);
				calls.push(url);
				return responder(url);
			},
		},
	};
}

describe("trending", () => {
	test("one GIPHY call per hour, served from cache in between", async () => {
		const h = harness();
		const first = await trendingGiphy(h.deps, { offset: 0 });
		expect(first.status).toBe("ok");
		expect(first.result.data).toHaveLength(GIPHY_PAGE_SIZE);
		h.setNow(TRENDING_TTL_MS - 1);
		await trendingGiphy(h.deps, { offset: 0 });
		expect(h.calls).toHaveLength(1);
		h.setNow(TRENDING_TTL_MS + 1);
		await trendingGiphy(h.deps, { offset: 0 });
		expect(h.calls).toHaveLength(2);
	});

	test("the request carries the key, the page size and pg-13", async () => {
		const h = harness();
		await trendingGiphy(h.deps, { offset: 0 });
		const call = h.calls[0];
		expect(call?.origin).toBe("https://api.giphy.test");
		expect(call?.pathname).toBe("/v1/gifs/trending");
		expect(call?.searchParams.get("api_key")).toBe("test-key");
		expect(call?.searchParams.get("rating")).toBe("pg-13");
		expect(call?.searchParams.get("limit")).toBe(String(GIPHY_PAGE_SIZE));
	});

	test("rate limited with a stale page: the stale page, marked busy", async () => {
		const h = harness();
		await trendingGiphy(h.deps, { offset: 0 });
		h.setNow(TRENDING_TTL_MS + 1);
		h.respond(() => new Response("", { status: 429 }));
		const next = await trendingGiphy(h.deps, { offset: 0 });
		expect(next.status).toBe("busy");
		expect(next.result.data).toHaveLength(GIPHY_PAGE_SIZE);
	});

	test("the trending ceiling stops the call", async () => {
		const h = harness();
		h.store.counts.set("global", TRENDING_CEILING);
		const result = await trendingGiphy(h.deps, { offset: 0 });
		expect(result.status).toBe("busy");
		expect(h.calls).toHaveLength(0);
	});

	test("no key: nothing leaves the server and no budget is spent", async () => {
		const h = harness(null);
		const result = await trendingGiphy(h.deps, { offset: 0 });
		expect(result.status).toBe("unavailable");
		expect(result.result.data).toEqual([]);
		const search = await searchGiphy(h.deps, {
			userId: "u1",
			query: "cats",
			offset: 0,
		});
		expect(search.status).toBe("unavailable");
		expect(h.calls).toHaveLength(0);
		expect(h.store.counts.size).toBe(0);
	});
});

describe("search", () => {
	test("normalized queries share one cache entry for a day", async () => {
		const h = harness();
		await searchGiphy(h.deps, {
			userId: "u1",
			query: "  Good   BYE ",
			offset: 0,
		});
		await searchGiphy(h.deps, { userId: "u2", query: "good bye", offset: 0 });
		h.setNow(SEARCH_TTL_MS - 1);
		await searchGiphy(h.deps, { userId: "u1", query: "GOOD bye", offset: 0 });
		expect(h.calls).toHaveLength(1);
		expect(h.calls[0]?.searchParams.get("q")).toBe("good bye");
		h.setNow(SEARCH_TTL_MS + 1);
		await searchGiphy(h.deps, { userId: "u1", query: "good bye", offset: 0 });
		expect(h.calls).toHaveLength(2);
	});

	test("under two characters shows trending and never searches", async () => {
		const h = harness();
		const result = await searchGiphy(h.deps, {
			userId: "u1",
			query: " a ",
			offset: 0,
		});
		expect(result.status).toBe("ok");
		expect(h.calls.map((c) => c.pathname)).toEqual(["/v1/gifs/trending"]);
	});

	test("ratings above pg-13 are dropped server side", async () => {
		const h = harness();
		h.respond(() =>
			Response.json({
				...page(["ok1"]),
				data: [
					gif("ok1", "g"),
					gif("bad", "r"),
					gif("pg13", "pg-13"),
					gif("none", ""),
				],
			}),
		);
		const result = await searchGiphy(h.deps, {
			userId: "u1",
			query: "cats",
			offset: 0,
		});
		expect(result.result.data.map((g) => g.id)).toEqual(["ok1", "pg13"]);
	});

	test("results carry no analytics payload or user, and only grid renditions", async () => {
		const h = harness();
		const result = await searchGiphy(h.deps, {
			userId: "u1",
			query: "cats",
			offset: 0,
		});
		const first = result.result.data[0];
		expect(first?.analytics_response_payload).toBe("");
		expect(first?.user).toBeUndefined();
		expect(Object.keys(first?.images ?? {}).sort()).toEqual([
			"fixed_height",
			"fixed_width",
		]);
	});

	test("offsets snap to pages and stop past the last page", async () => {
		const h = harness();
		await searchGiphy(h.deps, { userId: "u1", query: "cats", offset: 30 });
		expect(h.calls[0]?.searchParams.get("offset")).toBe(
			String(GIPHY_PAGE_SIZE),
		);
		const past = await searchGiphy(h.deps, {
			userId: "u1",
			query: "cats",
			offset: GIPHY_MAX_OFFSET + GIPHY_PAGE_SIZE,
		});
		expect(past.result.data).toEqual([]);
		expect(past.result.pagination.total_count).toBe(
			past.result.pagination.offset,
		);
		expect(h.calls).toHaveLength(1);
	});

	test("the last page ends the grid", async () => {
		const h = harness();
		const last = await searchGiphy(h.deps, {
			userId: "u1",
			query: "cats",
			offset: GIPHY_MAX_OFFSET,
		});
		const { offset, count, total_count } = last.result.pagination;
		expect(offset + count).toBe(total_count);
	});

	test("a short page ends the grid", async () => {
		const h = harness();
		h.respond(() => Response.json(page(["a", "b"])));
		const short = await searchGiphy(h.deps, {
			userId: "u1",
			query: "rare",
			offset: 0,
		});
		expect(short.result.pagination.total_count).toBe(2);
	});

	test("each person gets a share of the hourly budget", async () => {
		const h = harness();
		await trendingGiphy(h.deps, { offset: 0 });
		for (let i = 0; i < USER_HOURLY_LIMIT; i++) {
			const ok = await searchGiphy(h.deps, {
				userId: "greedy",
				query: `query ${i}`,
				offset: 0,
			});
			expect(ok.status).toBe("ok");
		}
		const busy = await searchGiphy(h.deps, {
			userId: "greedy",
			query: "one more",
			offset: 0,
		});
		expect(busy.status).toBe("busy");
		expect(busy.result.data[0]?.id).toBe("t0");
		expect(busy.result.pagination.total_count).toBe(busy.result.data.length);
		const other = await searchGiphy(h.deps, {
			userId: "someone-else",
			query: "one more",
			offset: 0,
		});
		expect(other.status).toBe("ok");
		expect(h.calls).toHaveLength(USER_HOURLY_LIMIT + 2);
	});

	test("near the global budget search stops but trending still refreshes", async () => {
		const h = harness();
		h.store.counts.set("global", SEARCH_CEILING);
		const busy = await searchGiphy(h.deps, {
			userId: "u1",
			query: "cats",
			offset: 0,
		});
		expect(busy.status).toBe("busy");
		expect(h.calls).toHaveLength(0);
		const trending = await trendingGiphy(h.deps, { offset: 0 });
		expect(trending.status).toBe("ok");
		expect(h.calls).toHaveLength(1);
	});

	test("cached searches cost nothing even when the budget is gone", async () => {
		const h = harness();
		await searchGiphy(h.deps, { userId: "u1", query: "cats", offset: 0 });
		h.store.counts.set("global", 1000);
		h.store.counts.set("user:u1", 1000);
		const cached = await searchGiphy(h.deps, {
			userId: "u1",
			query: "cats",
			offset: 0,
		});
		expect(cached.status).toBe("ok");
		expect(h.calls).toHaveLength(1);
	});

	test("GIPHY says 429: cached trending and a busy status", async () => {
		const h = harness();
		await trendingGiphy(h.deps, { offset: 0 });
		h.respond(() => new Response("", { status: 429 }));
		const busy = await searchGiphy(h.deps, {
			userId: "u1",
			query: "cats",
			offset: 0,
		});
		expect(busy.status).toBe("busy");
		expect(busy.result.data[0]?.id).toBe("t0");
		const nextPage = await searchGiphy(h.deps, {
			userId: "u1",
			query: "cats",
			offset: GIPHY_PAGE_SIZE,
		});
		expect(nextPage.status).toBe("busy");
		expect(nextPage.result.data).toEqual([]);
	});

	test("GIPHY down: a stale search page beats nothing", async () => {
		const h = harness();
		await searchGiphy(h.deps, { userId: "u1", query: "cats", offset: 0 });
		h.setNow(SEARCH_TTL_MS + 1);
		h.respond(() => new Response("", { status: 500 }));
		const stale = await searchGiphy(h.deps, {
			userId: "u1",
			query: "cats",
			offset: 0,
		});
		expect(stale.status).toBe("busy");
		expect(stale.result.data[0]?.id).toBe("cats-0");
	});
});

describe("memory layer", () => {
	test("fresh pages skip the database, expired ones go back to it", async () => {
		const inner = new FakeStore();
		let now = START.getTime();
		const store = createMemoryLayer(inner, {
			maxEntries: 2,
			now: () => new Date(now),
		});
		await store.write("a", page(["a"]), new Date(now + 1000));
		expect((await store.read("a"))?.body.data[0]?.id).toBe("a");
		expect(inner.reads).toBe(0);
		now += 2000;
		await store.read("a");
		expect(inner.reads).toBe(1);
	});

	test("keeps at most maxEntries pages", async () => {
		const inner = new FakeStore();
		const store = createMemoryLayer(inner, {
			maxEntries: 2,
			now: () => START,
		});
		const later = new Date(START.getTime() + 1000);
		await store.write("a", page(["a"]), later);
		await store.write("b", page(["b"]), later);
		await store.write("c", page(["c"]), later);
		await store.read("a");
		expect(inner.reads).toBe(1);
		await store.read("c");
		expect(inner.reads).toBe(1);
	});
});

describe("picking a gif", () => {
	test("stores the fixed height rendition without tracking params", () => {
		expect(closeGifFrom(gif("abc"))).toEqual({
			id: "abc",
			url: "https://media2.giphy.com/media/abc/200.gif",
			width: 356,
			height: 200,
			title: "abc GIF",
		});
	});

	test("refuses ratings above pg-13 and media off GIPHY", () => {
		expect(closeGifFrom(gif("abc", "r"))).toBeNull();
		const offsite = gif("abc");
		(
			offsite.images as unknown as Record<string, { url: string }>
		).fixed_height = {
			url: "https://evil.example/a.gif",
		};
		expect(closeGifFrom(offsite)).toBeNull();
	});

	test("finds a gif in a cached page", () => {
		expect(findGif(page(["a", "b"]), "b")?.id).toBe("b");
		expect(findGif(page(["a"]), "z")).toBeNull();
		expect(findGif(null, "a")).toBeNull();
	});

	test("normalizes queries", () => {
		expect(normalizeQuery("  Hello\tWORLD  ")).toBe("hello world");
		expect(normalizeQuery("x".repeat(80))).toHaveLength(50);
	});
});
