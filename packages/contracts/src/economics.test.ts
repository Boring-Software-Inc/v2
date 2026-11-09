import { describe, expect, test } from "bun:test";
import {
	creditRunwayMonths,
	deriveUsageSource,
	meteringEvidenceSchema,
	PLANETSCALE_MONTHLY,
	railwayPricesSchema,
	railwayRatesMetadataSchema,
	railwayServiceUsageSchema,
} from "./economics.ts";

/**
 * Source derivation is the COGS integrity boundary: prod is customer spend, eval
 * and dev are R&D. It is pure and never guesses — underivable is dev.
 */
describe("deriveUsageSource", () => {
	test("prod key under prod env is prod", () => {
		expect(deriveUsageSource({ keyKind: "prod", isProdEnv: true })).toBe(
			"prod",
		);
	});

	test("prod key off prod env is dev, not prod", () => {
		expect(deriveUsageSource({ keyKind: "prod", isProdEnv: false })).toBe(
			"dev",
		);
	});

	test("eval key is always eval", () => {
		expect(deriveUsageSource({ keyKind: "eval", isProdEnv: true })).toBe(
			"eval",
		);
		expect(deriveUsageSource({ keyKind: "eval", isProdEnv: false })).toBe(
			"eval",
		);
	});

	test("unknown or missing key is dev", () => {
		expect(deriveUsageSource({ keyKind: "dev", isProdEnv: true })).toBe("dev");
		expect(deriveUsageSource({ keyKind: null, isProdEnv: true })).toBe("dev");
	});
});

describe("stored economics schemas", () => {
	test("metering projects each optional field without erasing alternate SDK evidence", () => {
		const parsed = meteringEvidenceSchema.parse({
			evidence: {
				trace: {
					model: null,
					costUsd: Infinity,
					stepsUsed: "bad",
					steps: [],
					usage: {
						input: "bad",
						inputTokens: 0,
						output: 341,
						cached: null,
						inputTokenDetails: { cacheReadTokens: "bad", cachedTokens: 1041 },
					},
				},
			},
		});
		expect(parsed.evidence.trace).toEqual({
			model: "unknown",
			costUsd: null,
			stepsUsed: null,
			steps: [],
			usage: {
				input: null,
				inputTokens: 0,
				output: 341,
				outputTokens: null,
				cached: null,
				inputTokenDetails: { cacheReadTokens: null, cachedTokens: 1041 },
			},
		});
		for (const value of [
			null,
			[],
			{},
			{ evidence: { trace: { findings: 2 } } },
			{ evidence: { trace: { usage: [] } } },
		]) {
			expect(meteringEvidenceSchema.safeParse(value).success).toBe(false);
		}
	});

	test("Railway prices require finite numeric dictionaries, including a valid zero or empty baseline", () => {
		expect(railwayPricesSchema.parse({ prices: {} })).toEqual({ prices: {} });
		expect(railwayPricesSchema.parse({ prices: { cpu: 0 } })).toEqual({
			prices: { cpu: 0 },
		});
		for (const prices of [
			null,
			[],
			[0],
			Array(2),
			{ cpu: "0" },
			{ cpu: {} },
			{ cpu: NaN },
			{ cpu: Infinity },
			{ cpu: -Infinity },
		]) {
			expect(railwayPricesSchema.safeParse({ prices }).success).toBe(false);
		}
	});

	test("Railway read quantities preserve historical Number conversion and independent metadata fallback", () => {
		expect(
			railwayServiceUsageSchema.parse({
				name: "",
				cpuUnits: "2.5",
				memGbMin: false,
				egressGb: [2],
			}),
		).toEqual({ name: "", cpuUnits: 2.5, memGbMin: 0, egressGb: 2 });
		expect(railwayServiceUsageSchema.parse({})).toEqual({
			name: null,
			cpuUnits: 0,
			memGbMin: 0,
			egressGb: 0,
		});
		expect(
			railwayServiceUsageSchema.parse({ cpuUnits: "bad" }).cpuUnits,
		).toBeNaN();
		expect(
			railwayServiceUsageSchema.parse({ memGbMin: {} }).memGbMin,
		).toBeNaN();
		expect(
			railwayRatesMetadataSchema.parse({ ratesDrift: "true", verifiedAt: "" }),
		).toEqual({ ratesDrift: false, verifiedAt: "" });
		expect(
			railwayRatesMetadataSchema.parse({ ratesDrift: true, verifiedAt: 42 }),
		).toEqual({ ratesDrift: true, verifiedAt: null });
	});
});

describe("creditRunwayMonths", () => {
	test("divides balance by the accrued monthly", () => {
		expect(creditRunwayMonths(PLANETSCALE_MONTHLY * 22)).toBeCloseTo(22, 5);
		expect(creditRunwayMonths(954.55)).toBeCloseTo(954.55 / 45, 5);
	});
});
