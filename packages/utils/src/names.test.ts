import { describe, expect, test } from "bun:test";
import { generateWorkflowName, pickWorkflowName } from "./names.ts";

describe("generateWorkflowName", () => {
	test("adjective-noun shape", () => {
		expect(generateWorkflowName({ seed: 1 })).toMatch(/^[a-z]+-[a-z]+$/);
	});

	test("deterministic under a seed", () => {
		expect(generateWorkflowName({ seed: 42 })).toBe(
			generateWorkflowName({ seed: 42 }),
		);
	});

	test("different seeds diverge (spot check)", () => {
		const names = new Set(
			Array.from({ length: 50 }, (_, i) => generateWorkflowName({ seed: i })),
		);
		expect(names.size).toBeGreaterThan(30);
	});
});

describe("pickWorkflowName — collision retry", () => {
	test("returns the first candidate when free", () => {
		const first = generateWorkflowName({ seed: 7 });
		expect(pickWorkflowName(new Set(), { seed: 7 })).toBe(first);
	});

	test("retries past taken candidates", () => {
		// Seed 7's first candidate is taken — the picker must move on, not loop.
		const first = generateWorkflowName({ seed: 7 });
		const picked = pickWorkflowName(new Set([first]), { seed: 7 });
		expect(picked).not.toBe(first);
		expect(picked).toMatch(/^[a-z]+-[a-z]+(-\d+)?$/);
	});

	test("numeric suffix when every retry collides", () => {
		// Take EVERY possible adjective-noun combination the seed will produce
		// by exhausting retries: feed a set that contains all candidates.
		const taken = new Set<string>();
		for (let i = 0; i < 4000; i++) {
			taken.add(generateWorkflowName({ seed: i }));
		}
		const picked = pickWorkflowName(taken, { seed: 3, retries: 4 });
		expect(taken.has(picked)).toBe(false);
	});

	test("total even against an adversarial suffix squat", () => {
		const base = generateWorkflowName({ seed: 9 });
		const taken = new Set([base, `${base}-2`, `${base}-3`, `${base}-4`]);
		const picked = pickWorkflowName(taken, { seed: 9, retries: 1 });
		expect(taken.has(picked)).toBe(false);
	});
});
