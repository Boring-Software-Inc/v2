import { describe, expect, test } from "bun:test";
import {
	creditRunwayMonths,
	deriveUsageSource,
	PLANETSCALE_MONTHLY,
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

describe("creditRunwayMonths", () => {
	test("divides balance by the accrued monthly", () => {
		expect(creditRunwayMonths(PLANETSCALE_MONTHLY * 22)).toBeCloseTo(22, 5);
		expect(creditRunwayMonths(954.55)).toBeCloseTo(954.55 / 45, 5);
	});
});
