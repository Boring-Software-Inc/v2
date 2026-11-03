import { describe, expect, test } from "bun:test";
import { GithubHttp, GithubHttpError, type GithubHttpOptions } from "./http.ts";

/**
 * The metering hook (economics-surface-contracts.md): every request reports its
 * request and response body sizes, exactly once, without changing what the call
 * returns. A throw in the hook can never break a forge call.
 */
function httpWith(
	handler: (url: string, init?: RequestInit) => Response,
	onCall?: (b: { bytesIn: number; bytesOut: number }) => void,
	tokenFor: GithubHttpOptions["tokenFor"] = () => Promise.resolve("t"),
): GithubHttp {
	return new GithubHttp({
		tokenFor,
		appId: 1,
		onCall,
		fetchImpl: ((url: string | URL | Request, init?: RequestInit) =>
			Promise.resolve(handler(String(url), init))) as typeof fetch,
	});
}

describe("GithubHttp native transport contract", () => {
	test("keeps auth headers and omits content-type only for an undefined input", async () => {
		const seen: RequestInit[] = [];
		const http = httpWith((_url, init) => {
			if (!init) throw new Error("missing request init");
			seen.push(init);
			return new Response("null");
		});
		await http.get("acme/x", "/x");
		await http.delete("acme/x", "/x");
		await http.post("acme/x", "/x", undefined);
		await http.post("acme/x", "/x", () => "not JSON");
		await http.patch("acme/x", "/x", Symbol("not JSON"));
		await http.put("acme/x", "/x", null);
		expect(seen.map((init) => init.method)).toEqual([
			"GET",
			"DELETE",
			"POST",
			"POST",
			"PATCH",
			"PUT",
		]);
		expect(seen.map((init) => init.body)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"null",
		]);
		for (const [index, init] of seen.entries()) {
			const headers = new Headers(init.headers);
			expect(headers.get("authorization")).toBe("Bearer t");
			expect(headers.get("accept")).toBe("application/vnd.github+json");
			expect(headers.get("x-github-api-version")).toBe("2022-11-28");
			expect(headers.get("content-type")).toBe(
				index < 3 ? null : "application/json",
			);
		}
	});

	test("a toJSON returning undefined still sets content-type and meters zero sent bytes", async () => {
		const meters: { bytesIn: number; bytesOut: number }[] = [];
		const http = httpWith(
			(_url, init) => {
				expect(init?.body).toBeUndefined();
				expect(new Headers(init?.headers).get("content-type")).toBe(
					"application/json",
				);
				return new Response("null");
			},
			(call) => meters.push(call),
		);
		await http.post("acme/x", "/x", {
			toJSON() {
				return undefined;
			},
		});
		expect(meters).toEqual([{ bytesIn: 4, bytesOut: 0 }]);
	});

	test("preserves non-JSON native stringification through every write method", async () => {
		const seen: RequestInit[] = [];
		const http = httpWith((_url, init) => {
			if (!init) throw new Error("missing request init");
			seen.push(init);
			return new Response("null");
		});
		const body = {
			date: new Date("2026-01-01T00:00:00Z"),
			omitted: undefined,
			fn: () => 1,
			symbol: Symbol("omit"),
			array: [
				undefined,
				() => 1,
				Symbol("null"),
				Number.NaN,
				Number.POSITIVE_INFINITY,
			],
		};
		await http.post("acme/x", "/x", body);
		await http.patch("acme/x", "/x", body);
		await http.put("acme/x", "/x", body);
		await http.request("acme/x", "POST", "/x", body);
		expect(seen.map((init) => init.body)).toEqual(
			Array(4).fill(
				'{"date":"2026-01-01T00:00:00.000Z","array":[null,null,null,null,null]}',
			),
		);
	});

	test("looks up the token before serializing exactly once and meters that string", async () => {
		const order: string[] = [];
		const meters: { bytesIn: number; bytesOut: number }[] = [];
		let serialized = 0;
		const http = httpWith(
			(_url, init) => {
				order.push("fetch");
				expect(init?.body).toBe('{"calls":1,"text":"🚀"}');
				return new Response('"é"');
			},
			(call) => meters.push(call),
			async (repo) => {
				order.push(`token:${repo}`);
				return "t";
			},
		);
		const result = await http.post("acme/x", "/x", {
			toJSON() {
				order.push("serialize");
				serialized += 1;
				return { calls: serialized, text: "🚀" };
			},
		});
		expect(result).toBe("é");
		expect(order).toEqual(["token:acme/x", "serialize", "fetch"]);
		expect(serialized).toBe(1);
		expect(meters).toEqual([
			{ bytesIn: 3, bytesOut: '{"calls":1,"text":"🚀"}'.length },
		]);
	});

	test("token failure never serializes and serialization failures never fetch", async () => {
		const tokenFailure = new Error("token unavailable");
		let serialized = 0;
		let fetched = 0;
		const http = httpWith(
			() => {
				fetched += 1;
				return new Response("null");
			},
			undefined,
			async () => {
				throw tokenFailure;
			},
		);
		await expect(
			http.post("acme/x", "/x", {
				toJSON() {
					serialized += 1;
				},
			}),
		).rejects.toBe(tokenFailure);
		expect(serialized).toBe(0);
		expect(fetched).toBe(0);
		const writable = httpWith(() => {
			fetched += 1;
			return new Response("null");
		});
		const serializationFailure = new Error("toJSON failure");
		await expect(
			writable.post("acme/x", "/x", {
				toJSON() {
					throw serializationFailure;
				},
			}),
		).rejects.toBe(serializationFailure);
		await expect(writable.patch("acme/x", "/x", 1n)).rejects.toBeInstanceOf(
			TypeError,
		);
		const circular = { self: {} };
		circular.self = circular;
		await expect(writable.put("acme/x", "/x", circular)).rejects.toBeInstanceOf(
			TypeError,
		);
		expect(fetched).toBe(0);
	});

	test("retains native response parsing for scalars, nonfinite numbers, special keys and malformed JSON", async () => {
		for (const text of [
			'"text"',
			"true",
			"null",
			"42",
			"1e999",
			"-1e999",
			"[1,null]",
			'{"__proto__":{"polluted":true},"constructor":7}',
		]) {
			const http = httpWith(() => new Response(text));
			const result = await http.get("acme/x", "/x");
			expect(result).toEqual(JSON.parse(text));
			if (text.includes("__proto__"))
				expect(Object.getOwnPropertyNames(result)).toContain("__proto__");
		}
		const empty = httpWith(() => new Response(""));
		expect(await empty.get("acme/x", "/x")).toBeNull();
		const invalid = httpWith(() => new Response("not json"));
		await expect(invalid.get("acme/x", "/x")).rejects.toBeInstanceOf(
			SyntaxError,
		);
	});

	test.each([
		[429, {}, "busy", true],
		[403, { "x-ratelimit-remaining": "0" }, "denied", true],
		[403, { "retry-after": "5" }, "wait", true],
		[403, {}, "Rate limit exceeded", true],
		[403, {}, "denied", false],
		[500, {}, "server broke", false],
	])("preserves error and rate-limit shape for %s", async (status, headers, text, rateLimited) => {
		const meters: { bytesIn: number; bytesOut: number }[] = [];
		const http = httpWith(
			() => new Response(text, { status, headers }),
			(call) => meters.push(call),
		);
		await expect(http.get("acme/x", "/x")).rejects.toMatchObject({
			name: "GithubHttpError",
			status,
			rateLimited,
			message: `GET /x failed: ${status} ${text}`,
		});
		expect(meters).toEqual([{ bytesIn: text.length, bytesOut: 0 }]);
		await expect(http.get("acme/x", "/x")).rejects.toBeInstanceOf(
			GithubHttpError,
		);
	});
});

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
