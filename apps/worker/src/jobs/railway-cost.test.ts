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
	raw?: boolean;
}): typeof fetch {
	return Object.assign(
		(_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const body = String(init?.body ?? "");
			const pick = body.includes("usage(")
				? responses.usage
				: body.includes("services")
					? responses.services
					: responses.prices;
			const response = new Response(JSON.stringify({ data: pick }), {
				status: 200,
			});
			if (responses.raw) {
				Object.defineProperty(response, "json", {
					value: () => Promise.resolve({ data: pick }),
				});
			}
			return Promise.resolve(response);
		},
		{ preconnect: () => {} },
	);
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

describe("Railway boundary compatibility", () => {
	const opts = {
		token: "local-account-token",
		start: "2026-07-01T00:00:00Z",
		end: "2026-07-23T00:00:00Z",
		prevPrices: null,
	};

	test("usage preserves native Number conversion and ignores unknown or missing measurements", async () => {
		const result = await pullRailwayCost(
			routingFetch({
				usage: {
					usage: [
						{
							measurement: "CPU_USAGE",
							value: "2.5",
							tags: { serviceId: "worker" },
						},
						{
							measurement: "MEMORY_USAGE_GB",
							value: true,
							tags: { serviceId: "worker" },
						},
						{
							measurement: "NETWORK_TX_GB",
							value: [2],
							tags: { serviceId: 7 },
						},
						{ measurement: "CPU_USAGE", value: "bad" },
						{ measurement: "CPU_USAGE", value: Infinity },
						{
							measurement: "CPU_USAGE",
							value: null,
							tags: { serviceId: "zero" },
						},
						{ measurement: "OTHER", value: 999 },
						{ value: 999 },
					],
				},
				services: { project: null },
				prices: { me: null },
				raw: true,
			}),
			opts,
		);
		expect(JSON.stringify(result.services)).toBe(
			JSON.stringify([
				{
					serviceId: 7,
					name: 7,
					cpuUnits: 0,
					memGbMin: 0,
					egressGb: 2,
					costUsd: 2 * RAILWAY_RATES.NETWORK_TX_GB,
				},
				{
					serviceId: "worker",
					name: "worker",
					cpuUnits: 2.5,
					memGbMin: 1,
					egressGb: 0,
					costUsd:
						2.5 * RAILWAY_RATES.CPU_USAGE + RAILWAY_RATES.MEMORY_USAGE_GB,
				},
				{
					serviceId: "zero",
					name: "zero",
					cpuUnits: 0,
					memGbMin: 0,
					egressGb: 0,
					costUsd: 0,
				},
			]),
		);
		expect(result.prices).toEqual({});
	});

	test("price discrimination retains nonfinite numbers and skips hostile nonnumbers without dropping valid prices", async () => {
		const hostile = Object.defineProperty({}, "constructor", {
			get() {
				throw new Error("constructor read");
			},
		});
		const proxy = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error("prototype read");
				},
			},
		);
		const result = await pullRailwayCost(
			routingFetch({
				usage: { usage: null },
				services: { project: null },
				prices: {
					me: {
						workspaces: [
							{},
							{ customer: null },
							{
								customer: {
									subscriptions: [
										{},
										{
											items: [
												{ productId: "zero", priceDollars: 0 },
												{ productId: "nan", priceDollars: NaN },
												{ productId: "inf", priceDollars: Infinity },
												{ productId: "neg", priceDollars: -Infinity },
												{ productId: "string", priceDollars: "1" },
												{ productId: "hostile", priceDollars: hostile },
												{ productId: "proxy", priceDollars: proxy },
												{ productId: "after", priceDollars: 0.123456789 },
											],
										},
									],
								},
							},
						],
					},
				},
				raw: true,
			}),
			opts,
		);
		expect(result.services).toEqual([]);
		expect(result.prices).toEqual({
			zero: 0,
			nan: NaN,
			inf: Infinity,
			neg: -Infinity,
			after: 0.123456789,
		});
	});

	test("partial GraphQL errors win over data and ancillary errors fall back independently", async () => {
		const failed = Object.assign(
			(_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const usage = String(init?.body).includes("usage(");
				return Promise.resolve(
					new Response(
						JSON.stringify({
							data: usage ? { usage: [null] } : null,
							errors: [{ message: "local denied" }],
						}),
					),
				);
			},
			{ preconnect: () => {} },
		);
		await expect(pullRailwayCost(failed, opts)).rejects.toThrow(
			"railway graphql: local denied",
		);
		const ancillaryFailures = Object.assign(
			(_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const usage = String(init?.body).includes("usage(");
				return Promise.resolve(
					new Response(
						JSON.stringify(
							usage
								? {
										data: {
											usage: [
												{
													measurement: "CPU_USAGE",
													value: 100,
													tags: { serviceId: "worker" },
												},
											],
										},
									}
								: { data: null, errors: [{ message: "local denied" }] },
						),
					),
				);
			},
			{ preconnect: () => {} },
		);
		const result = await pullRailwayCost(ancillaryFailures, opts);
		expect(result.services[0]?.name).toBe("worker");
		expect(result.totalUsd).toBe(100 * RAILWAY_RATES.CPU_USAGE);
		expect(result.prices).toEqual({});
		expect(result.ratesDrift).toBe(false);
	});

	test("requests keep project and window scope and no-data failure remains explicit", async () => {
		const requests: string[] = [];
		const fetchImpl = Object.assign(
			(_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const body = String(init?.body);
				requests.push(body);
				return Promise.resolve(
					new Response(
						JSON.stringify({
							data: body.includes("usage(") ? { usage: [] } : {},
						}),
					),
				);
			},
			{ preconnect: () => {} },
		);
		await pullRailwayCost(fetchImpl, { ...opts, projectId: "local-project" });
		expect(requests).toHaveLength(3);
		expect(JSON.parse(requests[0] ?? "{}").variables).toEqual({
			projectId: "local-project",
			measurements: ["CPU_USAGE", "MEMORY_USAGE_GB", "NETWORK_TX_GB"],
			start: opts.start,
			end: opts.end,
		});
		expect(JSON.parse(requests[1] ?? "{}").variables).toEqual({
			id: "local-project",
		});
		const empty = Object.assign(() => Promise.resolve(new Response("{}")), {
			preconnect: () => {},
		});
		await expect(pullRailwayCost(empty, opts)).rejects.toThrow(
			"railway graphql: no data",
		);
	});
});
