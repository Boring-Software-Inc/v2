import { describe, expect, test } from "bun:test";
import { parseByteRange, serveBytes } from "#/lib/server/og/byte-range";

const bytes = new Uint8Array(Array.from({ length: 10 }, (_, i) => i));

function get(range?: string, method = "GET"): Request {
	return new Request("https://app.tripwire.sh/og/site.mp4", {
		method,
		headers: range ? { range } : {},
	});
}

describe("parseByteRange", () => {
	test("reads open, closed and suffix ranges", () => {
		expect(parseByteRange("bytes=0-1", 10)).toEqual({ start: 0, end: 1 });
		expect(parseByteRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
		expect(parseByteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
		expect(parseByteRange("bytes=8-99", 10)).toEqual({ start: 8, end: 9 });
	});

	test("refuses ranges past the end and ignores malformed ones", () => {
		expect(parseByteRange("bytes=10-", 10)).toBe("unsatisfiable");
		expect(parseByteRange("bytes=5-2", 10)).toBe("unsatisfiable");
		expect(parseByteRange("items=0-1", 10)).toBeNull();
		expect(parseByteRange(null, 10)).toBeNull();
	});
});

describe("serveBytes", () => {
	test("answers a range with 206 and the slice", async () => {
		const response = serveBytes(get("bytes=0-1"), bytes, "video/mp4", "x");
		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe("bytes 0-1/10");
		expect(response.headers.get("accept-ranges")).toBe("bytes");
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1]);
	});

	test("answers no range with the whole file", async () => {
		const response = serveBytes(get(), bytes, "video/mp4", "x");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-length")).toBe("10");
		expect((await response.arrayBuffer()).byteLength).toBe(10);
	});

	test("answers HEAD with headers only and a bad range with 416", async () => {
		const head = serveBytes(get(undefined, "HEAD"), bytes, "video/mp4", "x");
		expect(head.status).toBe(200);
		expect((await head.arrayBuffer()).byteLength).toBe(0);
		const bad = serveBytes(get("bytes=20-"), bytes, "video/mp4", "x");
		expect(bad.status).toBe(416);
		expect(bad.headers.get("content-range")).toBe("bytes */10");
	});
});
