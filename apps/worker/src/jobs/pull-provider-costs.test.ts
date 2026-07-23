import { describe, expect, mock, test } from "bun:test";
import { PLANETSCALE_MONTHLY } from "@tripwire/contracts";
import type { Logger } from "pino";
import {
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

function jsonResponse(body: unknown, status = 200): Response {
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

function fakeDb() {
	// upsertProviderCost hits the db; capture calls instead.
	const rows: unknown[] = [];
	return {
		rows,
		db: {
			insert: () => ({
				values: () => ({
					onConflictDoUpdate: () => {
						rows.push(1);
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
