import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "../index.ts";
import {
	findCachedGiphyPage,
	GIPHY_WINDOW_MS,
	readGiphyCache,
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

describe("giphy cache", () => {
	test("writes, overwrites and reads a page", async () => {
		await writeGiphyCache(db, "search:cats:0", { data: [] }, at(60), at(0));
		await writeGiphyCache(
			db,
			"search:cats:0",
			{ data: [{ id: "abc" }] },
			at(120),
			at(1),
		);
		const entry = await readGiphyCache(db, "search:cats:0");
		expect(entry?.body).toEqual({ data: [{ id: "abc" }] });
		expect(entry?.expiresAt.toISOString()).toBe(at(120).toISOString());
		expect(await readGiphyCache(db, "search:dogs:0")).toBeNull();
	});

	test("keeps stale pages for a fallback, prunes old ones", async () => {
		await writeGiphyCache(db, "trending:0", { data: [] }, at(-60), at(0));
		await writeGiphyCache(
			db,
			"other",
			{ data: [] },
			at(3 * 24 * 60),
			at(3 * 24 * 60),
		);
		expect(await readGiphyCache(db, "trending:0")).toBeNull();
		await writeGiphyCache(db, "trending:0", { data: [] }, at(-60), at(0));
		await writeGiphyCache(db, "other", { data: [] }, at(120), at(60));
		expect(await readGiphyCache(db, "trending:0")).not.toBeNull();
	});

	test("finds the page a gif was served on", async () => {
		await writeGiphyCache(
			db,
			"search:bye:0",
			{ data: [{ id: "bye1", title: "Bye" }] },
			at(60),
			at(0),
		);
		expect(await findCachedGiphyPage(db, "bye1")).toEqual({
			data: [{ id: "bye1", title: "Bye" }],
		});
		expect(await findCachedGiphyPage(db, "nope")).toBeNull();
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
