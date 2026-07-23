import { describe, expect, test } from "bun:test";
import { GithubHttp } from "./http.ts";

/**
 * The metering hook (economics-surface-contracts.md): every request reports its
 * request and response body sizes, exactly once, without changing what the call
 * returns. A throw in the hook can never break a forge call.
 */
function httpWith(
	handler: (url: string, init?: RequestInit) => Response,
	onCall?: (b: { bytesIn: number; bytesOut: number }) => void,
): GithubHttp {
	return new GithubHttp({
		tokenFor: () => Promise.resolve("t"),
		onCall,
		fetchImpl: ((url: string | URL | Request, init?: RequestInit) =>
			Promise.resolve(handler(String(url), init))) as typeof fetch,
	});
}

describe("GithubHttp onCall metering", () => {
	test("reports response and request bytes, returns parsed json", async () => {
		const calls: { bytesIn: number; bytesOut: number }[] = [];
		const body = { hello: "world" };
		const http = httpWith(
			() => new Response(JSON.stringify(body)),
			(b) => calls.push(b),
		);
		const result = await http.post("acme/x", "/repos/acme/x/issues", {
			title: "hi",
		});
		expect(result).toEqual(body);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.bytesIn).toBe(JSON.stringify(body).length);
		expect(calls[0]?.bytesOut).toBe(JSON.stringify({ title: "hi" }).length);
	});

	test("GET has zero request bytes", async () => {
		const calls: { bytesIn: number; bytesOut: number }[] = [];
		const http = httpWith(
			() => new Response("[]"),
			(b) => calls.push(b),
		);
		await http.get("acme/x", "/repos/acme/x/commits");
		expect(calls[0]?.bytesOut).toBe(0);
		expect(calls[0]?.bytesIn).toBe(2);
	});

	test("204 returns null and still meters", async () => {
		const calls: { bytesIn: number; bytesOut: number }[] = [];
		const http = httpWith(
			() => new Response(null, { status: 204 }),
			(b) => calls.push(b),
		);
		expect(await http.get("acme/x", "/x")).toBeNull();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.bytesIn).toBe(0);
	});

	test("a throwing hook never breaks the call", async () => {
		const http = httpWith(
			() => new Response(JSON.stringify({ ok: true })),
			() => {
				throw new Error("metering boom");
			},
		);
		expect(await http.get("acme/x", "/x")).toEqual({ ok: true });
	});

	test("a non-ok response still throws, with the body text", async () => {
		const http = httpWith(() => new Response("nope", { status: 404 }));
		let message = "";
		try {
			await http.get("acme/x", "/missing");
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("404 nope");
	});
});
