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
	expect(await res.json()).toEqual(snapshot);
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
	const textUrl = `${url}?format=txt`;
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
