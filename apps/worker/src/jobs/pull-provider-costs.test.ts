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
	test("sums the dollar field for records on the day", () => {
		const json = {
			data: [
				{ date: "2026-07-21", usage: 0.0119, tokens: 2934 },
				{ date: "2026-07-21", usage: 0.004, tokens: 800 },
				{ date: "2026-07-20", usage: 5, tokens: 999 },
			],
		};
		const out = extractOpenRouterDailyCost(json, "2026-07-21");
		expect(out.costUsd).toBeCloseTo(0.0159, 6);
		expect(out.tokens).toBe(3734);
	});

	test("tolerates unknown shapes without throwing", () => {
		expect(extractOpenRouterDailyCost(null, "2026-07-21").costUsd).toBe(0);
		expect(extractOpenRouterDailyCost({ nope: 1 }, "2026-07-21").costUsd).toBe(
			0,
		);
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
	openrouter: { managementKey: null, keyHashes: { prod: null, eval: null } },
	railway: { token: null, services: ["worker", "api", "web"] },
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
				keyHashes: { prod: null, eval: null },
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
				keyHashes: { prod: null, eval: null },
			},
		};
		const fetchImpl = mock(() =>
			Promise.resolve(
				jsonResponse({ data: [{ date: "2026-07-21", usage: 0.02 }] }),
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
});

describe("planetscale interpolation", () => {
	test("daily accrual is the monthly divided by days in month", () => {
		// July has 31 days; the interpolated daily figure is 45 / 31.
		expect(PLANETSCALE_MONTHLY / 31).toBeCloseTo(1.4516, 3);
	});
});
