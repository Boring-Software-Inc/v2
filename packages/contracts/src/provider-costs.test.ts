import { describe, expect, test } from "bun:test";
import {
	openRouterAnalyticsSchema,
	railwaySubscriptionPriceSchema,
	railwayUsageQuantitySchema,
} from "./provider-costs.ts";

describe("openRouterAnalyticsSchema", () => {
	test("decodes all envelopes and independent finite numeric fallbacks", () => {
		const records = [
			{ total_usage: 0, usage: 9, tokens_total: "2.5", api_key_id: "prod" },
			{ total_usage: "4", usage: 0.125, tokens_total: "", api_key_id: "" },
			{
				total_usage: Infinity,
				usage: NaN,
				cost: -0.25,
				tokens_total: "Infinity",
			},
			{ total_usage: null, usage: false, cost: 1e-10, tokens_total: true },
			null,
			[1],
			"bad",
		];
		const expected = [
			{ keyName: "prod", costUsd: 0, tokens: 2.5 },
			{ keyName: "", costUsd: 0.125, tokens: 0 },
			{ keyName: null, costUsd: -0.25, tokens: 0 },
			{ keyName: null, costUsd: 1e-10, tokens: 0 },
			...Array.from({ length: 3 }, () => ({
				keyName: null,
				costUsd: 0,
				tokens: 0,
			})),
		];
		for (const envelope of [
			records,
			{ data: records },
			{ data: { data: records } },
		]) {
			expect(openRouterAnalyticsSchema.parse(envelope)).toEqual(expected);
		}
	});

	test("unknown or malformed envelopes contribute no rows", () => {
		for (const value of [
			null,
			1,
			"bad",
			{},
			{ data: null },
			{ data: { data: {} } },
		]) {
			expect(openRouterAnalyticsSchema.parse(value)).toEqual([]);
		}
	});
});

describe("Railway numeric fields", () => {
	test("usage retains native Number conversion including nonfinite and malformed values", () => {
		for (const value of [
			undefined,
			null,
			false,
			true,
			"",
			"2.5",
			"bad",
			[],
			[2],
			{},
			NaN,
			Infinity,
			-Infinity,
		]) {
			expect(railwayUsageQuantitySchema.parse(value)).toBe(Number(value));
		}
	});

	test("subscription prices accept every numeric primitive and nothing else", () => {
		for (const value of [0, -1, NaN, Infinity, -Infinity]) {
			const result = railwaySubscriptionPriceSchema.safeParse(value);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe(value);
			}
		}
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
		for (const value of [undefined, null, true, "0", [], {}, hostile, proxy]) {
			expect(railwaySubscriptionPriceSchema.safeParse(value).success).toBe(
				false,
			);
		}
	});
});
