import { describe, expect, mock, test } from "bun:test";
import {
	type JsonValue,
	jsonValueSchema,
	PLANETSCALE_MONTHLY,
} from "@tripwire/contracts";
import type { providerCostsDaily } from "@tripwire/db";
import type { Logger } from "pino";
import {
	extractOpenRouterByKey,
	extractOpenRouterDailyCost,
	type PullConfig,
	previousUtcDay,
	pullProviderCosts,
} from "./pull-provider-costs.ts";

const noopLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
} as unknown as Logger;

function jsonResponse(body: JsonValue, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

describe("previousUtcDay", () => {
	test("returns the UTC day before, across a month boundary", () => {
		expect(previousUtcDay(new Date("2026-08-01T01:40:00Z"))).toBe("2026-07-31");
		expect(previousUtcDay(new Date("2026-07-22T01:40:00Z"))).toBe("2026-07-21");
	});
});

describe("extractOpenRouterDailyCost", () => {
	test("sums total_usage and tokens_total from the analytics/query shape", () => {
		const json = {
			data: {
				data: [
					{ total_usage: 0.0119, tokens_total: "2934" },
					{ total_usage: 0.004, tokens_total: 800 },
				],
				metadata: { row_count: 2 },
			},
		};
		const out = extractOpenRouterDailyCost(json);
		expect(out.costUsd).toBeCloseTo(0.0159, 6);
		expect(out.tokens).toBe(3734);
	});

	test("tolerates unknown shapes without throwing", () => {
		expect(extractOpenRouterDailyCost(null).costUsd).toBe(0);
		expect(extractOpenRouterDailyCost({ nope: 1 }).costUsd).toBe(0);
	});
});

function fakeDb(validateUsage = false) {
	const rows: (typeof providerCostsDaily.$inferInsert)[] = [];
	return {
		rows,
		db: {
			insert: () => ({
				values: (row: typeof providerCostsDaily.$inferInsert) => ({
					onConflictDoUpdate: () => {
						if (validateUsage) {
							jsonValueSchema.parse(row.usageJson);
						}
						rows.push(row);
						return Promise.resolve();
					},
				}),
			}),
		} as never,
	};
}

const DISABLED: PullConfig = {
	openrouter: { managementKey: null, keyNames: { prod: null, eval: null } },
	railway: { token: null },
	planetscale: { tokenId: null, token: null, org: null },
};

describe("pullProviderCosts orchestration", () => {
	test("skips providers without credentials, still writes interpolated PlanetScale", async () => {
		const { db, rows } = fakeDb();
		const fetchImpl = mock(() => Promise.resolve(jsonResponse({})));
		const result = await pullProviderCosts({
			db,
			logger: noopLogger,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			config: DISABLED,
			now: new Date("2026-07-22T01:40:00Z"),
		});
		expect(result.day).toBe("2026-07-21");
		expect(result.providers.openrouter).toBe("skipped");
		expect(result.providers.railway).toBe("skipped");
		expect(result.providers.planetscale).toBe("ok");
		expect(fetchImpl).not.toHaveBeenCalled(); // no tokens => no network
		expect(rows).toHaveLength(1); // interpolated PS row only
	});

	test("a failing provider does not block the others", async () => {
		const { db, rows } = fakeDb();
		const config: PullConfig = {
			...DISABLED,
			openrouter: {
				managementKey: "mk",
				keyNames: { prod: null, eval: null },
			},
		};
		const fetchImpl = mock(() =>
			Promise.resolve(jsonResponse({ error: "boom" }, 500)),
		);
		const result = await pullProviderCosts({
			db,
			logger: noopLogger,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			config,
			now: new Date("2026-07-22T01:40:00Z"),
		});
		expect(result.providers.openrouter).toBe("failed");
		expect(result.providers.planetscale).toBe("ok"); // still ran
		expect(rows).toHaveLength(1); // PS wrote despite OR failing
	});

	test("writes OpenRouter prod-key cost when configured", async () => {
		const { db, rows } = fakeDb();
		const config: PullConfig = {
			...DISABLED,
			openrouter: {
				managementKey: "mk",
				keyNames: { prod: null, eval: null },
			},
		};
		const fetchImpl = mock(() =>
			Promise.resolve(
				jsonResponse({ data: { data: [{ total_usage: 0.02 }] } }),
			),
		);
		const result = await pullProviderCosts({
			db,
			logger: noopLogger,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			config,
			now: new Date("2026-07-22T01:40:00Z"),
		});
		expect(result.providers.openrouter).toBe("ok");
		expect(rows).toHaveLength(2); // openrouter prod-key + planetscale
	});

	test("splits prod vs eval by key name when configured", async () => {
		const { db, rows } = fakeDb();
		const config: PullConfig = {
			...DISABLED,
			openrouter: {
				managementKey: "mk",
				keyNames: { prod: "tripwire-prod", eval: "tripwire-eval" },
			},
		};
		// One grouped response; the puller picks each key's row by name.
		const fetchImpl = mock(() =>
			Promise.resolve(
				jsonResponse({
					data: {
						data: [
							{
								api_key_id: "tripwire-prod",
								total_usage: 0.01,
								tokens_total: 900,
							},
							{
								api_key_id: "tripwire-eval",
								total_usage: 3.9,
								tokens_total: 500000,
							},
							{
								api_key_id: "tripwire",
								total_usage: 2.99,
								tokens_total: 400000,
							},
						],
					},
				}),
			),
		);
		const result = await pullProviderCosts({
			db,
			logger: noopLogger,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			config,
			now: new Date("2026-07-22T01:40:00Z"),
		});
		expect(result.providers.openrouter).toBe("ok");
		expect(fetchImpl).toHaveBeenCalledTimes(1); // one grouped query
		expect(rows).toHaveLength(3); // prod-key + eval-key + planetscale
	});

	test("railway is skipped without a token (Railway pricing tested in railway-cost.test)", async () => {
		const { db, rows } = fakeDb();
		const result = await pullProviderCosts({
			db,
			logger: noopLogger,
			fetchImpl: (() =>
				Promise.resolve(jsonResponse({}))) as unknown as typeof fetch,
			config: DISABLED,
			now: new Date("2026-07-22T01:40:00Z"),
		});
		expect(result.providers.railway).toBe("skipped");
		expect(rows).toHaveLength(1); // planetscale only
	});
});

describe("planetscale interpolation", () => {
	test("daily accrual is the monthly divided by days in month", () => {
		// July has 31 days; the interpolated daily figure is 45 / 31.
		expect(PLANETSCALE_MONTHLY / 31).toBeCloseTo(1.4516, 3);
	});
});

describe("OpenRouter fallback compatibility", () => {
	test("all three envelopes retain numeric fallback order and token conversion", () => {
		const records = [
			{ total_usage: 0, usage: 9, tokens_total: "2.5" },
			{ total_usage: "4", usage: 0.125, tokens_total: "" },
			{
				total_usage: Infinity,
				usage: NaN,
				cost: -0.25,
				tokens_total: "Infinity",
			},
			{ total_usage: null, usage: false, cost: 1e-10, tokens_total: true },
			null,
			"bad",
			[],
			{ tokens: 500 },
		];
		for (const envelope of [
			records,
			{ data: records },
			{ data: { data: records } },
		]) {
			expect(extractOpenRouterDailyCost(envelope)).toEqual({
				costUsd: -0.125 + 1e-10,
				tokens: 2.5,
			});
		}
	});

	test("split keys use last duplicate, ignore nonstring names, and retain empty names", () => {
		const result = extractOpenRouterByKey({
			data: {
				data: [
					{ api_key_id: "prod", total_usage: 3, tokens_total: 5 },
					{ api_key_id: 5, total_usage: 100 },
					{ api_key_id: "prod", usage: 0.01, tokens_total: "7" },
					{ api_key_id: "", cost: 0 },
				],
			},
		});
		expect([...result]).toEqual([
			["prod", { costUsd: 0.01, tokens: 7 }],
			["", { costUsd: 0, tokens: 0 }],
		]);
	});
});

describe("provider request and audit compatibility", () => {
	test("aggregate request keeps exact UTC range, raw extra audit keys, and four-decimal write", async () => {
		const { db, rows } = fakeDb();
		const raw = {
			data: {
				data: [
					{
						total_usage: 0.0123456789,
						tokens_total: "9",
						extra: { audit: true },
					},
				],
				metadata: { cursor: "kept" },
			},
		};
		const requests: { url: string; body: string }[] = [];
		const fetchImpl = Object.assign(
			mock((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				requests.push({ url: String(input), body: String(init?.body) });
				return Promise.resolve(jsonResponse(raw));
			}),
			{ preconnect: () => {} },
		);
		const result = await pullProviderCosts({
			db,
			logger: noopLogger,
			fetchImpl,
			config: {
				...DISABLED,
				openrouter: {
					managementKey: "local-key",
					keyNames: { prod: null, eval: null },
				},
			},
			now: new Date("2028-03-01T01:40:00Z"),
		});
		expect(result).toEqual({
			day: "2028-02-29",
			written: 2,
			providers: { openrouter: "ok", railway: "skipped", planetscale: "ok" },
		});
		expect(requests).toEqual([
			{
				url: "https://openrouter.ai/api/v1/analytics/query",
				body: JSON.stringify({
					metrics: ["total_usage", "tokens_total"],
					time_range: {
						start: "2028-02-29T00:00:00Z",
						end: "2028-03-01T00:00:00Z",
					},
				}),
			},
		]);
		expect(rows[0]).toMatchObject({
			provider: "openrouter",
			service: "prod-key",
			costUsd: "0.0123",
			usageJson: { tokens: 9, raw },
			estimated: false,
		});
		expect(rows[1]?.costUsd).toBe((PLANETSCALE_MONTHLY / 29).toFixed(4));
	});

	test("split query does not filter by hash and missing configured key writes zero", async () => {
		const { db, rows } = fakeDb();
		const requests: string[] = [];
		const fetchImpl = Object.assign(
			mock((_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				requests.push(String(init?.body));
				return Promise.resolve(
					jsonResponse({ data: [{ api_key_id: "other", total_usage: 999 }] }),
				);
			}),
			{ preconnect: () => {} },
		);
		await pullProviderCosts({
			db,
			logger: noopLogger,
			fetchImpl,
			config: {
				...DISABLED,
				openrouter: {
					managementKey: "local-key",
					keyNames: { prod: "prod", eval: "eval" },
				},
			},
			now: new Date("2026-08-01T01:40:00Z"),
		});
		expect(requests).toEqual([
			JSON.stringify({
				metrics: ["total_usage", "tokens_total"],
				dimensions: ["api_key_id"],
				time_range: {
					start: "2026-07-31T00:00:00Z",
					end: "2026-08-01T00:00:00Z",
				},
			}),
		]);
		expect(
			rows.slice(0, 2).map((row) => ({
				service: row.service,
				costUsd: row.costUsd,
				usageJson: row.usageJson,
			})),
		).toEqual([
			{
				service: "prod-key",
				costUsd: "0.0000",
				usageJson: { tokens: 0, keyName: "prod" },
			},
			{
				service: "eval-key",
				costUsd: "0.0000",
				usageJson: { tokens: 0, keyName: "eval" },
			},
		]);
	});

	test("PlanetScale HTTP error accrues but thrown transport failure remains failed", async () => {
		const config: PullConfig = {
			...DISABLED,
			planetscale: {
				tokenId: "local-id",
				token: "local-token",
				org: "local-org",
			},
		};
		const { db, rows } = fakeDb();
		const fetchImpl = Object.assign(
			mock(() => Promise.resolve(jsonResponse({}, 500))),
			{ preconnect: () => {} },
		);
		const result = await pullProviderCosts({
			db,
			logger: noopLogger,
			fetchImpl,
			config,
			now: new Date("2026-07-22T01:40:00Z"),
		});
		expect(result.providers.planetscale).toBe("ok");
		expect(rows[0]).toMatchObject({
			costUsd: (45 / 31).toFixed(4),
			usageJson: { note: "interpolated from PLANETSCALE_MONTHLY" },
		});
		const failFetch = Object.assign(
			mock(() => Promise.reject(new Error("local transport failed"))),
			{ preconnect: () => {} },
		);
		const failed = await pullProviderCosts({
			db,
			logger: noopLogger,
			fetchImpl: failFetch,
			config,
		});
		expect(failed.providers.planetscale).toBe("failed");
		expect(failed.written).toBe(0);
	});

	test("PlanetScale invoice preserves the complete provider JSON", async () => {
		const { db, rows } = fakeDb();
		const invoice = {
			data: [{ amount: "45.000000", extra: [null, true, { credit: "audit" }] }],
			metadata: { page: 3 },
		};
		const fetchImpl = Object.assign(
			mock(() => Promise.resolve(jsonResponse(invoice))),
			{ preconnect: () => {} },
		);
		await pullProviderCosts({
			db,
			logger: noopLogger,
			fetchImpl,
			config: {
				...DISABLED,
				planetscale: {
					tokenId: "local-id",
					token: "local-token",
					org: "local-org",
				},
			},
		});
		expect(rows[0]?.usageJson).toEqual(invoice);
	});
});

test("a rejecting write double fails only that provider and leaves PlanetScale accrual intact", async () => {
	const { db, rows } = fakeDb(true);
	const fetchImpl = Object.assign(
		() =>
			Promise.resolve(
				new Response(
					'{"data":[{"total_usage":1e999,"usage":0.125,"audit":"retained"}]}',
				),
			),
		{ preconnect: () => {} },
	);
	const result = await pullProviderCosts({
		db,
		logger: noopLogger,
		fetchImpl,
		config: {
			...DISABLED,
			openrouter: {
				managementKey: "local-key",
				keyNames: { prod: null, eval: null },
			},
		},
		now: new Date("2026-07-22T01:40:00Z"),
	});
	expect(result.providers).toEqual({
		openrouter: "failed",
		railway: "skipped",
		planetscale: "ok",
	});
	expect(result.written).toBe(1);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.provider).toBe("planetscale");
});
