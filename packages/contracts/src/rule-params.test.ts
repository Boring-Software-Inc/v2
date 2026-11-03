import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { aiReviewConfigSchema } from "./review.ts";
import {
	accountAgeConfigSchema,
	englishOnlyConfigSchema,
	formatParamValue,
	RULE_CATALOG,
	type RuleParam,
	ruleUiSchema,
} from "./rules.ts";

function shapeKeys(schema: z.ZodType): string[] {
	return schema instanceof z.ZodObject ? Object.keys(schema.shape) : [];
}

/**
 * §9 drift guard — the readable-params descriptors are DISPLAY metadata layered
 * beside the zod `configSchema` (the validation truth). These weld them: a
 * descriptor can't name a param the schema doesn't have, its defaults must match
 * `defaultConfig`, and a config built from those defaults must pass the schema.
 */
describe("rule params ↔ config schema stay in sync", () => {
	for (const entry of RULE_CATALOG) {
		const ui = ruleUiSchema(`${entry.ruleId}@${entry.version}`);
		test(`${entry.ruleId}: every rule has a ui schema`, () => {
			expect(ui).not.toBeNull();
		});
		if (!ui) {
			continue;
		}

		test(`${entry.ruleId}: every param key exists in the config schema`, () => {
			const keys = shapeKeys(entry.configSchema);
			for (const p of ui.params) {
				expect(keys).toContain(p.key);
			}
		});

		test(`${entry.ruleId}: every defaultConfig key has a param descriptor`, () => {
			const paramKeys = ui.params.map((p) => p.key);
			for (const key of Object.keys(entry.defaultConfig)) {
				expect(paramKeys).toContain(key);
			}
		});

		test(`${entry.ruleId}: param defaults match defaultConfig and pass the schema`, () => {
			const cfg: Record<string, RuleParam["default"]> = {};
			const defaults = new Map(Object.entries(entry.defaultConfig));
			for (const p of ui.params) {
				if ("default" in p && p.default !== undefined) {
					cfg[p.key] = p.default;
					if (p.key in entry.defaultConfig) {
						expect(defaults.get(p.key)).toEqual(p.default);
					}
				}
			}
			expect(entry.configSchema.safeParse(cfg).success).toBe(true);
		});

		test(`${entry.ruleId}: every sentence placeholder names a real param`, () => {
			const paramKeys = new Set(ui.params.map((p) => p.key));
			for (const sentence of ui.sentences) {
				for (const m of sentence.matchAll(/\{(\w+)\}/g)) {
					expect(paramKeys.has(m[1] as string)).toBe(true);
				}
			}
		});
	}

	test("crypto-address is param-less: no params, no sentences", () => {
		const ui = ruleUiSchema("crypto-address@1");
		expect(ui?.params).toEqual([]);
		expect(ui?.sentences).toEqual([]);
	});
});

describe("formatParamValue renders units and percent", () => {
	const num = (over: Partial<Extract<RuleParam, { kind: "number" }>>) =>
		({
			key: "k",
			label: "k",
			kind: "number",
			int: true,
			default: 0,
			...over,
		}) satisfies Extract<RuleParam, { kind: "number" }>;

	test("unit rides inline with the number, never a bare value", () => {
		expect(formatParamValue(num({ unit: "files", default: 200 }), 200)).toBe(
			"200 files",
		);
		expect(formatParamValue(num({ unit: "days" }), 7)).toBe("7 days");
		expect(formatParamValue(num({ unit: "steps" }), 12)).toBe("12 steps");
	});

	test("percent params render 0–1 as a percentage", () => {
		expect(formatParamValue(num({ percent: true, int: false }), 0.5)).toBe(
			"50%",
		);
	});

	test("no unit ⇒ bare number", () => {
		expect(formatParamValue(num({ default: 5 }), 5)).toBe("5");
	});

	test("falls back to the default when value is absent", () => {
		expect(
			formatParamValue(num({ unit: "files", default: 200 }), undefined),
		).toBe("200 files");
	});

	test("malformed scalar values keep their display defaults without coercion", () => {
		const number = num({ unit: "days", default: 7 });
		for (const value of [null, "3", false, [], {}, Symbol("value")]) {
			expect(formatParamValue(number, value)).toBe("7 days");
		}
		const text: RuleParam = {
			key: "model",
			label: "model",
			kind: "string",
			default: "default",
		};
		for (const value of [null, undefined, "", 3, [], {}]) {
			expect(formatParamValue(text, value)).toBe("default");
		}
		expect(formatParamValue(text, " ")).toBe(" ");
		expect(
			formatParamValue(
				{ key: "enabled", label: "enabled", kind: "boolean", default: true },
				"true",
			),
		).toBe("off");
	});

	test("nonfinite numeric display remains distinct from config validation", () => {
		for (const value of [NaN, Infinity, -Infinity]) {
			expect(formatParamValue(num({ unit: "days" }), value)).toBe(
				`${String(value)} days`,
			);
			expect(formatParamValue(num({ percent: true }), value)).toBe(
				`${String(value)}%`,
			);
			expect(accountAgeConfigSchema.safeParse({ minDays: value }).success).toBe(
				false,
			);
		}
	});

	test("string-list keeps arbitrary array formatting and non-array fallback", () => {
		const param: RuleParam = {
			key: "paths",
			label: "paths",
			kind: "string-list",
			default: ["default/**"],
		};
		expect(
			formatParamValue(param, ["a", null, undefined, 3, false, {}, ["b", "c"]]),
		).toBe("a, , , 3, false, [object Object], b,c");
		expect(formatParamValue(param, new Array(2))).toBe(", ");
		for (const value of [null, undefined, "a", {}, 3]) {
			expect(formatParamValue(param, value)).toBe("default/**");
		}
	});

	test("string-list joins entries", () => {
		expect(
			formatParamValue(
				{ key: "paths", label: "p", kind: "string-list", default: ["a"] },
				["a/**", "b/**"],
			),
		).toBe("a/**, b/**");
	});
});

describe("config schemas reject out-of-range / wrong-type at the boundary", () => {
	test("account-age: negative days rejected", () => {
		expect(accountAgeConfigSchema.safeParse({ minDays: -1 }).success).toBe(
			false,
		);
	});
	test("english-only: ratio above 1 rejected", () => {
		expect(
			englishOnlyConfigSchema.safeParse({ maxNonLatinRatio: 2 }).success,
		).toBe(false);
	});
	test("ai-review: maxSteps above 15 rejected", () => {
		expect(aiReviewConfigSchema.safeParse({ maxSteps: 20 }).success).toBe(
			false,
		);
	});
	test("account-age: wrong type rejected", () => {
		expect(accountAgeConfigSchema.safeParse({ minDays: "lots" }).success).toBe(
			false,
		);
	});
});
