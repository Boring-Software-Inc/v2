import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { GithubAppDeliveries } from "./deliveries.ts";

const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});
const credentials = { appId: "1", privateKey };

function delivery(id: number, deliveredAt: string, overrides = {}) {
	return {
		id,
		guid: `guid-${id}`,
		delivered_at: deliveredAt,
		redelivery: false,
		duration: 0.1,
		status: "OK",
		status_code: 200,
		event: "pull_request",
		action: "opened",
		installation_id: 7,
		repository_id: 42,
		...overrides,
	};
}

function fakeFetch(
	routes: Record<string, () => Response>,
	calls: string[] = [],
): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		const key = `${init?.method ?? "GET"} ${url.pathname}${url.search}`;
		calls.push(key);
		const route = routes[key];
		if (!route) return new Response("not found", { status: 404 });
		return route();
	}) as typeof fetch;
}

describe("GithubAppDeliveries", () => {
	test("pages through the log until it reaches deliveries before `since`", async () => {
		const calls: string[] = [];
		const client = new GithubAppDeliveries({
			credentials,
			fetchImpl: fakeFetch(
				{
					"GET /app/hook/deliveries?per_page=100": () =>
						Response.json(
							[
								delivery(3, "2026-11-27T02:00:00Z"),
								delivery(2, "2026-11-27T01:30:00Z", {
									status_code: 502,
									action: null,
									repository_id: null,
								}),
							],
							{
								headers: {
									link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=abc>; rel="next"',
								},
							},
						),
					"GET /app/hook/deliveries?per_page=100&cursor=abc": () =>
						Response.json(
							[
								delivery(1, "2026-11-27T01:10:00Z"),
								delivery(0, "2026-11-27T00:50:00Z"),
							],
							{
								headers: {
									link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=def>; rel="next"',
								},
							},
						),
				},
				calls,
			),
		});
		const found = await client.listSince(new Date("2026-11-27T01:00:00Z"));
		expect(found.map((d) => d.id)).toEqual(["3", "2", "1"]);
		expect(found[1]).toMatchObject({
			guid: "guid-2",
			statusCode: 502,
			action: null,
			installationId: "7",
			repositoryId: null,
		});
		// It stopped once a page reached `since` instead of following `def`.
		expect(calls).toHaveLength(2);
	});

	test("keeps delivery ids past 2^53 exact, so they can be read and redelivered", async () => {
		// The size of ids in the staging App's log. As a JS number it rounds to
		// 3856363353404342300, an id GitHub 404s on.
		const id = "3856363353404342293";
		const calls: string[] = [];
		const client = new GithubAppDeliveries({
			credentials,
			fetchImpl: fakeFetch(
				{
					"GET /app/hook/deliveries?per_page=100": () =>
						new Response(
							JSON.stringify([delivery(0, "2026-11-27T05:58:43Z")]).replace(
								'"id":0',
								`"id": ${id}`,
							),
						),
					[`GET /app/hook/deliveries/${id}`]: () =>
						Response.json({
							event: "issues",
							request: { payload: { action: "opened" } },
						}),
					[`POST /app/hook/deliveries/${id}/attempts`]: () =>
						new Response(null, { status: 202 }),
				},
				calls,
			),
		});
		const [found] = await client.listSince(new Date("2026-11-27T05:00:00Z"));
		expect(found?.id).toBe(id);
		await client.payload(id);
		await client.redeliver(id);
		expect(calls.slice(1)).toEqual([
			`GET /app/hook/deliveries/${id}`,
			`POST /app/hook/deliveries/${id}/attempts`,
		]);
	});

	test("fails rather than return a log it couldn't read to `since`", async () => {
		let calls = 0;
		const client = new GithubAppDeliveries({
			credentials,
			fetchImpl: (async (_input: string | URL | Request) => {
				calls++;
				return Response.json([delivery(calls, "2026-11-27T02:00:00Z")], {
					headers: {
						link: `<https://api.github.com/app/hook/deliveries?per_page=100&cursor=${calls}>; rel="next"`,
					},
				});
			}) as typeof fetch,
		});
		await expect(
			client.listSince(new Date("2026-11-27T01:00:00Z")),
		).rejects.toThrow("webhook deliveries since");
		expect(calls).toBe(200);
	});

	test("reads a payload as the raw body ingest receives", async () => {
		const client = new GithubAppDeliveries({
			credentials,
			fetchImpl: fakeFetch({
				"GET /app/hook/deliveries/9": () =>
					Response.json({
						...delivery(9, "2026-11-27T02:00:00Z"),
						request: { headers: {}, payload: { action: "opened" } },
						response: { headers: {}, payload: "" },
					}),
			}),
		});
		expect(await client.payload("9")).toEqual({
			event: "pull_request",
			body: '{"action":"opened"}',
		});
	});

	test("asks GitHub to redeliver and fails loudly when it refuses", async () => {
		const calls: string[] = [];
		const client = new GithubAppDeliveries({
			credentials,
			fetchImpl: fakeFetch(
				{
					"POST /app/hook/deliveries/9/attempts": () =>
						new Response(null, { status: 202 }),
				},
				calls,
			),
		});
		await client.redeliver("9");
		expect(calls).toEqual(["POST /app/hook/deliveries/9/attempts"]);
		await expect(client.redeliver("10")).rejects.toThrow("404");
	});
});
