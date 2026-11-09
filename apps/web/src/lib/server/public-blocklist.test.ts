import { expect, test } from "bun:test";
import { handlePublicBlocklist } from "./public-blocklist";

const url = "https://staging.tripwire.sh/api/blocklist";

test("serves a public snapshot and refuses writes without contacting the source", async () => {
	const snapshot = {
		version: 1 as const,
		revision: 1,
		publishedAt: "2026-11-07T20:00:00Z",
		entries: [],
	};
	const res = await handlePublicBlocklist(
		new Request(url),
		async () => snapshot,
	);
	expect(res.status).toBe(200);
	expect(res.headers.get("access-control-allow-origin")).toBe("*");
	expect(await res.json()).toEqual({
		...snapshot,
		total: 0,
		matches: 0,
		page: 1,
		pageCount: 1,
		pageSize: 25,
	});
	const write = await handlePublicBlocklist(
		new Request(url, { method: "POST" }),
		async () => {
			throw new Error("Write reached the source");
		},
	);
	expect(write.status).toBe(405);
	expect(
		(await handlePublicBlocklist(new Request(url), async () => null)).status,
	).toBe(503);
	const head = await handlePublicBlocklist(
		new Request(url, { method: "HEAD" }),
		async () => snapshot,
	);
	expect(head.status).toBe(200);
	expect(await head.text()).toBe("");
});

test("paginates JSON results and searches across the whole list", async () => {
	const snapshot = {
		version: 1 as const,
		revision: 9,
		publishedAt: "2026-11-07T23:04:03Z",
		entries: Array.from({ length: 52 }, (_, index) => ({
			accountId: String(index + 1),
			login: `account-${index + 1}`,
			reason: "Repeated bounty claims",
			expiresAt: null,
		})),
	};
	const read = async (query = "") =>
		(
			await handlePublicBlocklist(
				new Request(url + query),
				async () => snapshot,
			)
		).json();

	expect(await read()).toEqual({
		...snapshot,
		entries: snapshot.entries.slice(0, 25),
		total: 52,
		matches: 52,
		page: 1,
		pageCount: 3,
		pageSize: 25,
	});
	expect(await read("?page=2")).toMatchObject({
		page: 2,
		entries: snapshot.entries.slice(25, 50),
	});
	expect(await read("?page=4")).toMatchObject({
		page: 3,
		entries: snapshot.entries.slice(50),
	});
	expect(await read("?q=%40ACCOUNT-52")).toMatchObject({
		total: 52,
		matches: 1,
		page: 1,
		pageCount: 1,
		entries: snapshot.entries.slice(51),
	});
});

test("exports just the published usernames as plain text", async () => {
	const snapshot = {
		version: 1 as const,
		revision: 1,
		publishedAt: "2026-11-07T20:00:00Z",
		entries: [
			{ accountId: "1", login: "first", reason: "Test", expiresAt: null },
			{ accountId: "2", login: "second", reason: "Test", expiresAt: null },
		],
	};
	const textUrl = `${url}?format=txt&page=2&q=first`;
	const res = await handlePublicBlocklist(
		new Request(textUrl),
		async () => snapshot,
	);
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
	expect(await res.text()).toBe("first\nsecond\n");
	const head = await handlePublicBlocklist(
		new Request(textUrl, { method: "HEAD" }),
		async () => snapshot,
	);
	expect(head.headers.get("content-type")).toBe(
		res.headers.get("content-type"),
	);
	expect(await head.text()).toBe("");
	const unavailable = await handlePublicBlocklist(
		new Request(textUrl),
		async () => null,
	);
	expect(unavailable.status).toBe(503);
});
