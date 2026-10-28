import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { giphyPageSchema } from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import { giphyCache } from "../schema/giphy.ts";
import {
	claimGiphyFill,
	findCachedGiphyPage,
	GIPHY_WINDOW_MS,
	readGiphyCache,
	releaseGiphyFill,
	reserveGiphyCall,
	writeGiphyCache,
} from "./giphy.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

beforeAll(async () => {
	container = await createTestDatabase();
	const handle = createDb(container.url);
	db = handle.db;
	pool = handle.pool;
	await applyMigrations(db);
});

afterAll(async () => {
	await pool.end();
	await container.stop();
});

const HOUR_START = new Date("2026-10-25T10:00:00.000Z");

function at(minutes: number): Date {
	return new Date(HOUR_START.getTime() + minutes * 60_000);
}

function gif(id: string) {
	return {
		id,
		rating: "g" as const,
		title: `${id} GIF`,
		type: "gif",
		images: {
			fixed_height: {
				url: `https://media.giphy.com/media/${id}/200.gif`,
				width: "356",
				height: "200",
			},
			fixed_width: {
				url: `https://media.giphy.com/media/${id}/200w.gif`,
				width: "200",
				height: "112",
			},
		},
	};
}

function page(...ids: string[]) {
	return {
		data: ids.map(gif),
		pagination: { total_count: ids.length, count: ids.length, offset: 0 },
		meta: { status: 200, msg: "OK", response_id: "r" },
	};
}

describe("giphy cache", () => {
	test("writes, overwrites and reads a page", async () => {
		await writeGiphyCache(db, "search:cats:0", page(), at(60), at(0));
		await writeGiphyCache(db, "search:cats:0", page("abc"), at(120), at(1));
		const entry = await readGiphyCache(db, "search:cats:0");
		expect(entry?.body).toEqual(giphyPageSchema.parse(page("abc")));
		expect(entry?.expiresAt.toISOString()).toBe(at(120).toISOString());
		expect(await readGiphyCache(db, "search:dogs:0")).toBeNull();
	});

	test("refuses a page that is not a GIPHY page", async () => {
		await expect(
			writeGiphyCache(db, "bad", { data: [{ id: "x" }] }, at(60), at(0)),
		).rejects.toThrow();
		const offsite = page("abc");
		for (const item of offsite.data) {
			item.images.fixed_height.url = "https://evil.example/a.gif";
		}
		await expect(
			writeGiphyCache(db, "bad", offsite, at(60), at(0)),
		).rejects.toThrow();
		expect(await readGiphyCache(db, "bad")).toBeNull();
	});

	test("a corrupt stored page reads as a miss", async () => {
		await db.insert(giphyCache).values({
			key: "corrupt",
			body: { data: "nope" },
			expiresAt: at(60),
		});
		expect(await readGiphyCache(db, "corrupt")).toBeNull();
	});

	test("keeps stale pages for a fallback, prunes old ones", async () => {
		await writeGiphyCache(db, "trending:0", page(), at(-60), at(0));
		await writeGiphyCache(
			db,
			"other",
			page(),
			at(3 * 24 * 60),
			at(3 * 24 * 60),
		);
		expect(await readGiphyCache(db, "trending:0")).toBeNull();
		await writeGiphyCache(db, "trending:0", page(), at(-60), at(0));
		await writeGiphyCache(db, "other", page(), at(120), at(60));
		expect(await readGiphyCache(db, "trending:0")).not.toBeNull();
	});

	test("finds the page a gif was served on", async () => {
		await writeGiphyCache(db, "search:bye:0", page("bye1"), at(60), at(0));
		expect(await findCachedGiphyPage(db, "bye1")).toEqual(
			giphyPageSchema.parse(page("bye1")),
		);
		expect(await findCachedGiphyPage(db, "nope")).toBeNull();
	});
});

describe("giphy fills", () => {
	test("one filler per key until it releases or the lease runs out", async () => {
		expect(await claimGiphyFill(db, "trending:0", 10_000, at(0))).toBe(true);
		expect(await claimGiphyFill(db, "trending:0", 10_000, at(0))).toBe(false);
		expect(await claimGiphyFill(db, "trending:24", 10_000, at(0))).toBe(true);
		await releaseGiphyFill(db, "trending:0");
		expect(await claimGiphyFill(db, "trending:0", 10_000, at(0))).toBe(true);
		expect(await claimGiphyFill(db, "trending:0", 10_000, at(1))).toBe(true);
	});

	test("concurrent claims: exactly one wins", async () => {
		const results = await Promise.all(
			Array.from({ length: 20 }, () =>
				claimGiphyFill(db, "search:race:0", 10_000, at(0)),
			),
		);
		expect(results.filter(Boolean)).toHaveLength(1);
	});
});

describe("giphy budget", () => {
	test("allows up to the limit in a window, then refuses", async () => {
		const results: boolean[] = [];
		for (let i = 0; i < 4; i++) {
			results.push(await reserveGiphyCall(db, "global-a", 3, at(5)));
		}
		expect(results).toEqual([true, true, true, false]);
	});

	test("scopes are independent", async () => {
		expect(await reserveGiphyCall(db, "user:1", 1, at(5))).toBe(true);
		expect(await reserveGiphyCall(db, "user:1", 1, at(6))).toBe(false);
		expect(await reserveGiphyCall(db, "user:2", 1, at(6))).toBe(true);
	});

	test("the last window still counts early in the next one", async () => {
		for (let i = 0; i < 4; i++) {
			expect(await reserveGiphyCall(db, "slide", 4, at(50))).toBe(true);
		}
		expect(await reserveGiphyCall(db, "slide", 4, at(61))).toBe(false);
		expect(await reserveGiphyCall(db, "slide", 4, at(90))).toBe(true);
		expect(await reserveGiphyCall(db, "slide", 4, at(91))).toBe(true);
		expect(await reserveGiphyCall(db, "slide", 4, at(92))).toBe(false);
	});

	test("concurrent reservations never pass the limit", async () => {
		const now = new Date(HOUR_START.getTime() + 5 * GIPHY_WINDOW_MS);
		const results = await Promise.all(
			Array.from({ length: 20 }, () => reserveGiphyCall(db, "race", 7, now)),
		);
		expect(results.filter(Boolean)).toHaveLength(7);
	});
});
