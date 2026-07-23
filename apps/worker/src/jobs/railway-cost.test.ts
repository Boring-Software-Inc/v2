import { describe, expect, test } from "bun:test";
import {
	detectRateDrift,
	priceRailwayUsage,
	pullRailwayCost,
} from "./railway-cost.ts";
import { RAILWAY_RATES } from "./railway-rates.ts";

/**
 * Railway cost is quantities x verified rates. The rates were confirmed against
 * the real web/worker/api totals on 2026-07-22, so these tests pin the math.
 */
describe("priceRailwayUsage", () => {
	test("prices per service and keeps the raw quantities", () => {
		// worker: CPU 282.58 vCPU-min, RAM 1467.08 GB-min, egress 2.69 GB.
		const rows = [
			{ measurement: "CPU_USAGE", value: 282.58, serviceId: "worker" },
			{ measurement: "MEMORY_USAGE_GB", value: 1467.08, serviceId: "worker" },
			{ measurement: "NETWORK_TX_GB", value: 2.69, serviceId: "worker" },
		];
		const { services, totalUsd } = priceRailwayUsage(
			rows,
			new Map([["worker", "worker"]]),
		);
		expect(services).toHaveLength(1);
		const s = services[0];
		expect(s?.cpuUnits).toBe(282.58);
		expect(s?.memGbMin).toBe(1467.08);
		expect(s?.egressGb).toBe(2.69);
		// 282.58*0.000463 + 1467.08*0.000231 + 2.69*0.05 = 0.6047 (matches dashboard 0.60)
		expect(s?.costUsd).toBeCloseTo(0.6047, 3);
		expect(totalUsd).toBeCloseTo(0.6047, 3);
	});

	test("resolves names, falls back to the service id, skips unknown measurements", () => {
		const rows = [
			{ measurement: "CPU_USAGE", value: 100, serviceId: "svc-1" },
			{ measurement: "DISK_USAGE_GB", value: 999, serviceId: "svc-1" }, // not billed here
			{ measurement: "NETWORK_TX_GB", value: 1, serviceId: null },
		];
		const { services } = priceRailwayUsage(rows, new Map([["svc-1", "api"]]));
		const named = services.find((s) => s.name === "api");
		expect(named?.costUsd).toBeCloseTo(100 * RAILWAY_RATES.CPU_USAGE, 6);
		expect(services.some((s) => s.name === "(project)")).toBe(true); // null id bucket
	});
});

describe("detectRateDrift", () => {
	test("no baseline means no drift", () => {
		expect(detectRateDrift(null, { p1: 0.5 })).toBe(false);
	});
	test("same prices, no drift", () => {
		expect(detectRateDrift({ p1: 0.5 }, { p1: 0.5 })).toBe(false);
	});
	test("a changed price is drift", () => {
		expect(detectRateDrift({ p1: 0.5 }, { p1: 0.6 })).toBe(true);
	});
	test("a new product is not drift on its own", () => {
		expect(detectRateDrift({ p1: 0.5 }, { p1: 0.5, p2: 0.9 })).toBe(false);
	});
});

/** Route the fake fetch by which GraphQL query is sent. */
function routingFetch(responses: {
	usage: unknown;
	services: unknown;
	prices: unknown;
}): typeof fetch {
	return ((_url: string, init?: RequestInit) => {
		const body = String(init?.body ?? "");
		const pick = body.includes("usage(")
			? responses.usage
			: body.includes("services")
				? responses.services
				: responses.prices;
		return Promise.resolve(
			new Response(JSON.stringify({ data: pick }), { status: 200 }),
		);
	}) as unknown as typeof fetch;
}

describe("pullRailwayCost", () => {
	test("prices services, resolves names, and flags rate drift", async () => {
		const fetchImpl = routingFetch({
			usage: {
				usage: [
					{ measurement: "CPU_USAGE", value: 100, tags: { serviceId: "s1" } },
					{ measurement: "NETWORK_TX_GB", value: 2, tags: { serviceId: "s2" } },
				],
			},
			services: {
				project: {
					services: {
						edges: [
							{ node: { id: "s1", name: "worker" } },
							{ node: { id: "s2", name: "web" } },
						],
					},
				},
			},
			prices: {
				me: {
					workspaces: [
						{
							customer: {
								subscriptions: [
									{ items: [{ productId: "cpu", priceDollars: 0.9 }] },
								],
							},
						},
					],
				},
			},
		});
		const result = await pullRailwayCost(fetchImpl, {
			token: "acct",
			start: "2026-07-01T00:00:00Z",
			end: "2026-07-23T00:00:00Z",
			prevPrices: { cpu: 0.5 }, // differs from 0.9 => drift
		});
		expect(result.services.map((s) => s.name).sort()).toEqual([
			"web",
			"worker",
		]);
		expect(result.totalUsd).toBeCloseTo(
			100 * RAILWAY_RATES.CPU_USAGE + 2 * RAILWAY_RATES.NETWORK_TX_GB,
			6,
		);
		expect(result.prices).toEqual({ cpu: 0.9 });
		expect(result.ratesDrift).toBe(true);
	});

	test("a usage GraphQL error rejects (so the pull is marked failed)", async () => {
		const fetchImpl = (() =>
			Promise.resolve(
				new Response(
					JSON.stringify({ errors: [{ message: "Not Authorized" }] }),
					{
						status: 200,
					},
				),
			)) as unknown as typeof fetch;
		let threw = false;
		try {
			await pullRailwayCost(fetchImpl, {
				token: "proj-token",
				start: "2026-07-01T00:00:00Z",
				end: "2026-07-23T00:00:00Z",
				prevPrices: null,
			});
		} catch (e) {
			threw = e instanceof Error && e.message.includes("Not Authorized");
		}
		expect(threw).toBe(true);
	});
});
