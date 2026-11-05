import { describe, expect, test } from "bun:test";
import { costUsd, isPriced, PRICING } from "./config.ts";

describe("eval pricing", () => {
	test("retains measured cached tokens and fresh-token floor", () => {
		expect(
			costUsd("x-ai/grok-4.5", { input: 100, output: 10, cached: 20 }),
		).toBe((80 * 2 + 20 * 0.5 + 10 * 6) / 1_000_000);
		expect(costUsd("x-ai/grok-4.5", { input: 10, output: 0, cached: 20 })).toBe(
			10 / 1_000_000,
		);
		expect(costUsd("not-priced", { input: 100, output: 100, cached: 0 })).toBe(
			0,
		);
		expect(isPriced("not-priced")).toBe(false);
		expect(Object.keys(PRICING)).toHaveLength(5);
	});

	test("preserves legacy prototype-key lookup semantics", () => {
		expect(isPriced("toString")).toBe(true);
		expect(isPriced("constructor")).toBe(true);
		expect(costUsd("toString", { input: 1, output: 1, cached: 0 })).toBeNaN();
	});
});
