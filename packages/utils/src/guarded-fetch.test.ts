import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
	guardedPost,
	guardedPostMultipart,
	isBlockedAddress,
	isBlockedIpv4,
	isBlockedIpv6,
	isDeliverableUrl,
} from "./guarded-fetch.ts";

function requestFromFetch(
	input: Parameters<typeof fetch>[0],
	init?: RequestInit,
) {
	return input instanceof Request
		? new Request(input, init)
		: new Request(String(input), init);
}

/**
 * The SSRF guard's proof. The happy path never touches these branches, so this
 * suite is the artifact that says the boundary holds: every blocked range (v4
 * and v6), non-https refusal, redirect refusal, timeout, and body cap.
 */

describe("isBlockedIpv4 — every private/reserved range refused", () => {
	const BLOCKED = [
		["0.0.0.0", "this-host"],
		["10.0.0.1", "private-10"],
		["10.255.255.255", "private-10-top"],
		["127.0.0.1", "loopback"],
		["127.1.2.3", "loopback-wide"],
		["100.64.0.1", "cgnat"],
		["100.127.255.255", "cgnat-top"],
		["169.254.0.1", "link-local"],
		["169.254.169.254", "cloud-metadata"],
		["172.16.0.1", "private-172"],
		["172.31.255.255", "private-172-top"],
		["192.168.0.1", "private-192"],
		["192.0.2.5", "test-net-1"],
		["198.18.0.1", "benchmark"],
		["198.51.100.7", "test-net-2"],
		["203.0.113.9", "test-net-3"],
		["224.0.0.1", "multicast"],
		["240.0.0.1", "reserved"],
		["255.255.255.255", "broadcast"],
	] as const;
	for (const [ip, label] of BLOCKED) {
		test(`blocks ${label} (${ip})`, () => {
			expect(isBlockedIpv4(ip)).toBe(true);
		});
	}

	const ALLOWED = [
		"8.8.8.8",
		"1.1.1.1",
		"140.82.112.3",
		"172.15.0.1",
		"172.32.0.1",
		"100.63.0.1",
		"100.128.0.1",
	];
	for (const ip of ALLOWED) {
		test(`allows public ${ip}`, () => {
			expect(isBlockedIpv4(ip)).toBe(false);
		});
	}

	test("refuses garbage that is not a dotted quad", () => {
		expect(isBlockedIpv4("999.1.1.1")).toBe(true);
		expect(isBlockedIpv4("nope")).toBe(true);
		expect(isBlockedIpv4("1.2.3")).toBe(true);
	});
});

describe("isBlockedIpv6 — loopback, ULA, link-local, mapped v4", () => {
	const BLOCKED = [
		["::1", "loopback"],
		["::", "unspecified"],
		["fe80::1", "link-local"],
		["fc00::1", "unique-local"],
		["fd12:3456::1", "unique-local-fd"],
		["ff02::1", "multicast"],
		["::ffff:127.0.0.1", "mapped-loopback"],
		["::ffff:169.254.169.254", "mapped-metadata"],
		["::ffff:10.0.0.1", "mapped-private"],
	] as const;
	for (const [ip, label] of BLOCKED) {
		test(`blocks ${label} (${ip})`, () => {
			expect(isBlockedIpv6(ip)).toBe(true);
		});
	}
	test("allows only global unicast 2000::/3", () => {
		expect(isBlockedIpv6("2606:4700:4700::1111")).toBe(false);
		expect(isBlockedIpv6("3001:db8::1")).toBe(false);
	});
});

describe("isBlockedAddress — dispatches by family, refuses non-IPs", () => {
	test("refuses a hostname (not an IP)", () => {
		expect(isBlockedAddress("example.com")).toBe(true);
	});
	test("classifies v4 and v6", () => {
		expect(isBlockedAddress("127.0.0.1")).toBe(true);
		expect(isBlockedAddress("8.8.8.8")).toBe(false);
		expect(isBlockedAddress("::1")).toBe(true);
	});
});

describe("isDeliverableUrl — shape gate (save-time)", () => {
	test("rejects non-https", () => {
		expect(isDeliverableUrl("http://example.com/hook")).toBe(false);
		expect(isDeliverableUrl("ftp://example.com")).toBe(false);
		expect(isDeliverableUrl("file:///etc/passwd")).toBe(false);
	});
	test("rejects unparseable", () => {
		expect(isDeliverableUrl("not a url")).toBe(false);
		expect(isDeliverableUrl("")).toBe(false);
	});
	test("rejects an https literal-IP host in a blocked range", () => {
		expect(isDeliverableUrl("https://169.254.169.254/latest")).toBe(false);
		expect(isDeliverableUrl("https://127.0.0.1/hook")).toBe(false);
	});
	test("accepts a well-formed https url", () => {
		expect(isDeliverableUrl("https://discord.com/api/webhooks/1/abc")).toBe(
			true,
		);
		expect(isDeliverableUrl("https://example.com/hook")).toBe(true);
	});
});

describe("guardedPost — the delivery gate", () => {
	test("refuses non-https before any network", async () => {
		const result = await guardedPost("http://example.com/hook", { a: 1 });
		expect(result).toEqual({ ok: false, failure: "not-https" });
	});

	test("refuses an invalid url", async () => {
		const result = await guardedPost("::::bad", { a: 1 });
		expect(result).toEqual({ ok: false, failure: "invalid-url" });
	});

	test("refuses a literal loopback IP at delivery time", async () => {
		const result = await guardedPost("https://127.0.0.1/hook", { a: 1 });
		expect(result).toEqual({ ok: false, failure: "blocked-destination" });
	});

	test("refuses the cloud metadata IP at delivery time", async () => {
		const result = await guardedPost("https://169.254.169.254/latest", {});
		expect(result).toEqual({ ok: false, failure: "blocked-destination" });
	});

	test("refuses a mapped-v4 loopback literal", async () => {
		const result = await guardedPost("https://[::ffff:127.0.0.1]/hook", {});
		expect(result).toEqual({ ok: false, failure: "blocked-destination" });
	});

	test("refuses a hostname that resolves only to loopback (TOCTOU gate)", async () => {
		const result = await guardedPost(
			"https://localhost/hook",
			{ a: 1 },
			{ lookupImpl: async () => [{ address: "127.0.0.1" }] },
		);
		expect(result).toEqual({ ok: false, failure: "blocked-destination" });
	});

	test("refuses an unresolvable host", async () => {
		const result = await guardedPost(
			"https://nonexistent.invalid.tld.example/hook",
			{},
			{
				lookupImpl: () => Promise.reject(new Error("unresolvable")),
			},
		);
		expect(result).toEqual({ ok: false, failure: "unresolvable-host" });
	});
});

/**
 * Transport branches — unreachable via localhost because the IP guard blocks
 * it, so a fake resolver returns a PUBLIC address and a fake fetch drives each
 * branch. The IP guard is real in these; only DNS + the socket are faked.
 */
describe("guardedPost — transport guards", () => {
	const publicDns = async () => [{ address: "8.8.8.8" }];
	const okFetch = (async () =>
		new Response(null, { status: 200 })) as unknown as typeof fetch;

	test("a 3xx is a refusal, never a followed hop", async () => {
		const fetchImpl = (async () =>
			new Response(null, {
				status: 302,
				headers: { location: "https://127.0.0.1/" },
			})) as unknown as typeof fetch;
		const result = await guardedPost(
			"https://hook.example/x",
			{},
			{ lookupImpl: publicDns, fetchImpl },
		);
		expect(result).toEqual({ ok: false, failure: "redirected", status: 302 });
	});

	test("a timeout is named, not thrown", async () => {
		const fetchImpl = (async () => {
			const err = new Error("timed out");
			err.name = "TimeoutError";
			throw err;
		}) as unknown as typeof fetch;
		const result = await guardedPost(
			"https://hook.example/x",
			{},
			{ lookupImpl: publicDns, fetchImpl },
		);
		expect(result).toEqual({ ok: false, failure: "timeout" });
	});

	test("a 5xx is an http-error with its status", async () => {
		const fetchImpl = (async () =>
			new Response("boom", { status: 503 })) as unknown as typeof fetch;
		const result = await guardedPost(
			"https://hook.example/x",
			{},
			{ lookupImpl: publicDns, fetchImpl },
		);
		expect(result).toEqual({ ok: false, failure: "http-error", status: 503 });
	});

	test("a 2xx is ok, and only a bounded slice of the body is read", async () => {
		let chunksPulled = 0;
		const huge = new ReadableStream<Uint8Array>({
			pull(controller) {
				// 1MB per chunk — the cap must stop the read well before this
				// 100MB stream drains.
				chunksPulled += 1;
				controller.enqueue(new Uint8Array(1024 * 1024));
				if (chunksPulled > 100) {
					controller.close();
				}
			},
		});
		const fetchImpl = (async () =>
			new Response(huge, { status: 200 })) as unknown as typeof fetch;
		const result = await guardedPost(
			"https://hook.example/x",
			{},
			{ lookupImpl: publicDns, fetchImpl },
		);
		expect(result).toEqual({ ok: true, status: 200 });
		// 64KB cap ⇒ the read stops after the first 1MB chunk crosses it.
		expect(chunksPulled).toBeLessThan(3);
	});

	test("a happy 2xx returns ok", async () => {
		const result = await guardedPost(
			"https://hook.example/x",
			{},
			{ lookupImpl: publicDns, fetchImpl: okFetch },
		);
		expect(result).toEqual({ ok: true, status: 200 });
	});

	test("a multi-record host with ANY blocked address is refused", async () => {
		const mixed = async () => [
			{ address: "8.8.8.8" },
			{ address: "127.0.0.1" },
		];
		const result = await guardedPost(
			"https://hook.example/x",
			{},
			{ lookupImpl: mixed, fetchImpl: okFetch },
		);
		expect(result).toEqual({ ok: false, failure: "blocked-destination" });
	});
});

describe("guardedPost — delivery headers + HMAC sign-once", () => {
	const publicDns = async () => [{ address: "8.8.8.8" }];

	/** Capture the exact body string + headers the transport received. */
	function capture() {
		const seen = { body: "", headers: new Headers(), redirect: "" };
		const fetchImpl = Object.assign(
			async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const request = requestFromFetch(input, init);
				seen.body = await request.text();
				seen.headers = request.headers;
				seen.redirect = request.redirect;
				return new Response(null, { status: 200 });
			},
			{ preconnect: fetch.preconnect },
		);
		return { seen, fetchImpl };
	}

	test("delivery id rides as BOTH X-Delivery-ID and Idempotency-Key", async () => {
		const { seen, fetchImpl } = capture();
		await guardedPost(
			"https://hook.example/x",
			{ a: 1 },
			{ lookupImpl: publicDns, fetchImpl, deliveryId: "row-123" },
		);
		expect(seen.headers.get("x-delivery-id")).toBe("row-123");
		expect(seen.headers.get("idempotency-key")).toBe("row-123");
		expect(seen.headers.get("x-webhook-timestamp")).toMatch(/^\d+$/);
		expect(seen.headers.get("content-type")).toBe("application/json");
		expect(seen.headers.get("authorization")).toBeNull();
		expect(seen.redirect).toBe("manual");
	});

	test("no signature header when no secret is set", async () => {
		const { seen, fetchImpl } = capture();
		await guardedPost(
			"https://hook.example/x",
			{ a: 1 },
			{ lookupImpl: publicDns, fetchImpl, deliveryId: "row-1" },
		);
		expect(seen.headers.get("x-webhook-signature")).toBeNull();
	});

	test("the signature verifies against the EXACT wire body (sign-once)", async () => {
		const { seen, fetchImpl } = capture();
		const secret = "shhh";
		await guardedPost(
			"https://hook.example/x",
			{ z: 1, a: 2, nested: { b: [3, 4] } },
			{
				lookupImpl: publicDns,
				fetchImpl,
				deliveryId: "row-9",
				signingSecret: secret,
			},
		);
		const header = seen.headers.get("x-webhook-signature") ?? "";
		const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header);
		expect(match).not.toBeNull();
		const ts = match?.[1];
		const sig = match?.[2];
		// Recompute over the timestamp in the header + the body that was SENT.
		const expected = createHmac("sha256", secret)
			.update(`${ts}.${seen.body}`)
			.digest("hex");
		expect(sig).toBe(expected);
	});

	test("serializes toJSON exactly once before signing and sending", async () => {
		const { seen, fetchImpl } = capture();
		let calls = 0;
		const result = await guardedPost(
			"https://hook.example/x",
			{
				toJSON() {
					calls += 1;
					return { calls, omitted: undefined };
				},
			},
			{ lookupImpl: publicDns, fetchImpl, signingSecret: "secret" },
		);
		expect(result).toEqual({ ok: true, status: 200 });
		expect(calls).toBe(1);
		expect(seen.body).toBe('{"calls":1}');
		const header = seen.headers.get("x-webhook-signature") ?? "";
		const timestamp = /^t=(\d+),/.exec(header)?.[1];
		expect(header).toBe(
			`t=${timestamp},v1=${createHmac("sha256", "secret").update(`${timestamp}.${seen.body}`).digest("hex")}`,
		);
	});

	test("keeps delivery identifiers stable across retry attempts", async () => {
		const first = capture();
		const second = capture();
		for (const { seen, fetchImpl } of [first, second]) {
			expect(
				await guardedPost(
					"https://hook.example/x",
					{ a: 1 },
					{
						lookupImpl: publicDns,
						fetchImpl,
						deliveryId: "logical-delivery",
					},
				),
			).toEqual({ ok: true, status: 200 });
			expect(seen.headers.get("x-delivery-id")).toBe("logical-delivery");
			expect(seen.headers.get("idempotency-key")).toBe("logical-delivery");
		}
		expect(first.seen.body).toBe(second.seen.body);
	});

	test("invalid header bytes remain a network-error value", async () => {
		const { fetchImpl } = capture();
		expect(
			await guardedPost(
				"https://hook.example/x",
				{},
				{
					lookupImpl: publicDns,
					fetchImpl,
					deliveryId: "invalid\nheader",
				},
			),
		).toEqual({ ok: false, failure: "network-error" });
	});
});

describe("guarded JSON serialization semantics", () => {
	const publicDns = async () => [{ address: "8.8.8.8" }];

	test("POST preserves native top-level omissions as TypeError before fetch", async () => {
		let fetched = false;
		const fetchImpl = Object.assign(
			async () => {
				fetched = true;
				return new Response(null, { status: 200 });
			},
			{ preconnect: fetch.preconnect },
		);
		for (const body of [undefined, () => 1, Symbol("body")]) {
			await expect(
				guardedPost("https://hook.example/x", body, {
					lookupImpl: publicDns,
					fetchImpl,
				}),
			).rejects.toThrow(TypeError);
		}
		expect(fetched).toBe(false);
	});

	test("multipart retains native coercion of an omitted payload", async () => {
		const payloads: ReturnType<FormData["getAll"]> = [];
		const fetchImpl = Object.assign(
			async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const form = await requestFromFetch(input, init).formData();
				payloads.push(...form.getAll("payload_json"));
				return new Response(null, { status: 200 });
			},
			{ preconnect: fetch.preconnect },
		);
		for (const body of [undefined, () => 1, Symbol("body")]) {
			expect(
				await guardedPostMultipart("https://hook.example/x", body, [], {
					lookupImpl: publicDns,
					fetchImpl,
				}),
			).toEqual({ ok: true, status: 200 });
		}
		expect(payloads).toEqual(["undefined", "undefined", "undefined"]);
	});

	test("both POST paths propagate native serialization errors unchanged", async () => {
		const cause = new Error("serialization");
		const cycle = {};
		Object.defineProperty(cycle, "self", { value: cycle, enumerable: true });
		for (const body of [
			{
				get field() {
					throw cause;
				},
			},
			{
				toJSON() {
					throw cause;
				},
			},
		]) {
			for (const send of [
				() =>
					guardedPost("https://hook.example/x", body, {
						lookupImpl: publicDns,
					}),
				() =>
					guardedPostMultipart("https://hook.example/x", body, [], {
						lookupImpl: publicDns,
					}),
			]) {
				let caught: unknown;
				try {
					await send();
				} catch (error) {
					caught = error;
				}
				expect(caught).toBe(cause);
			}
		}
		for (const body of [cycle, 1n]) {
			await expect(
				guardedPost("https://hook.example/x", body, { lookupImpl: publicDns }),
			).rejects.toThrow(TypeError);
			await expect(
				guardedPostMultipart("https://hook.example/x", body, [], {
					lookupImpl: publicDns,
				}),
			).rejects.toThrow(TypeError);
		}
	});

	test("POST retains Date, nonfinite and undefined-field wire semantics", async () => {
		const bodies: string[] = [];
		const fetchImpl = Object.assign(
			async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				bodies.push(await requestFromFetch(input, init).text());
				return new Response(null, { status: 200 });
			},
			{ preconnect: fetch.preconnect },
		);
		for (const body of [
			null,
			true,
			42,
			"message",
			new Date("2026-10-01T00:00:00.000Z"),
			{ kept: 1, omitted: undefined, notFinite: Number.NaN },
			[undefined, Number.POSITIVE_INFINITY],
		]) {
			expect(
				await guardedPost("https://hook.example/x", body, {
					lookupImpl: publicDns,
					fetchImpl,
				}),
			).toEqual({ ok: true, status: 200 });
			expect(bodies.at(-1)).toBe(JSON.stringify(body));
		}
	});

	test("both paths refuse destinations before evaluating the payload", async () => {
		let serialized = false;
		const body = {
			toJSON() {
				serialized = true;
				throw new Error("must not serialize");
			},
		};
		const blocked = {
			lookupImpl: async () => [
				{ address: "8.8.8.8" },
				{ address: "127.0.0.1" },
			],
		};
		expect(await guardedPost("https://hook.example/x", body, blocked)).toEqual({
			ok: false,
			failure: "blocked-destination",
		});
		expect(
			await guardedPostMultipart("https://hook.example/x", body, [], blocked),
		).toEqual({ ok: false, failure: "blocked-destination" });
		expect(serialized).toBe(false);
	});

	test("multipart file cap is applied before payload serialization or fetch", async () => {
		let serialized = false;
		expect(
			await guardedPostMultipart(
				"https://hook.example/x",
				{
					toJSON() {
						serialized = true;
						throw new Error("must not serialize");
					},
				},
				[
					{
						field: "files[0]",
						filename: "large.png",
						contentType: "image/png",
						bytes: new Uint8Array(256 * 1024 + 1),
					},
				],
				{ lookupImpl: publicDns },
			),
		).toEqual({ ok: false, failure: "body-too-large" });
		expect(serialized).toBe(false);
	});

	test("outbound cap counts UTF-8 bytes and never calls fetch", async () => {
		let fetched = false;
		const fetchImpl = Object.assign(
			async () => {
				fetched = true;
				return new Response(null, { status: 200 });
			},
			{ preconnect: fetch.preconnect },
		);
		expect(
			await guardedPost("https://hook.example/x", "é".repeat(128 * 1024), {
				lookupImpl: publicDns,
				fetchImpl,
			}),
		).toEqual({ ok: false, failure: "body-too-large" });
		expect(fetched).toBe(false);
	});

	test("multipart preserves payload, file parts and manual redirect protection", async () => {
		let calls = 0;
		const fetchImpl = Object.assign(
			async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				calls += 1;
				const request = requestFromFetch(input, init);
				expect(request.redirect).toBe("manual");
				expect(request.signal).toBeInstanceOf(AbortSignal);
				expect(request.headers.get("authorization")).toBeNull();
				const form = await request.formData();
				expect(form.get("payload_json")).toBe('{"calls":1}');
				const file = form.get("files[0]");
				expect(file).toBeInstanceOf(File);
				if (!(file instanceof File)) throw new Error("missing attachment");
				expect(file.name).toBe("chart.png");
				expect(file.type).toBe("image/png");
				expect(new Uint8Array(await file.arrayBuffer())).toEqual(
					new Uint8Array([1, 2, 3]),
				);
				return new Response(null, {
					status: 302,
					headers: { location: "https://127.0.0.1/" },
				});
			},
			{ preconnect: fetch.preconnect },
		);
		let serialized = 0;
		const payload = {
			toJSON() {
				serialized += 1;
				return { calls: serialized };
			},
		};
		expect(
			await guardedPostMultipart(
				"https://hook.example/x",
				payload,
				[
					{
						field: "files[0]",
						filename: "chart.png",
						contentType: "image/png",
						bytes: new Uint8Array([1, 2, 3]),
					},
				],
				{ lookupImpl: publicDns, fetchImpl },
			),
		).toEqual({ ok: false, failure: "redirected", status: 302 });
		expect(serialized).toBe(1);
		expect(calls).toBe(1);
	});
});
