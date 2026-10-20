import { describe, expect, test } from "bun:test";
import type { RuleParam } from "@tripwire/contracts";
import { coerceParamInput } from "./coerce";

const numParam = (
	over: Partial<Extract<RuleParam, { kind: "number" }>>,
): Extract<RuleParam, { kind: "number" }> => ({
	key: "k",
	label: "k",
	kind: "number",
	int: true,
	default: 0,
	...over,
});

/**
 * §9 edit boundary — out-of-range / wrong-type is rejected BEFORE the mutation,
 * with the same range the schema enforces (the server safe-parse is the backstop).
 */
describe("coerceParamInput", () => {
	test("valid integer passes through", () => {
		expect(coerceParamInput(numParam({ min: 0 }), "12")).toEqual({
			ok: true,
			value: 12,
		});
	});

	test("fraction rejected when the param is an integer", () => {
		const r = coerceParamInput(numParam({}), "1.5");
		expect(r.ok).toBe(false);
	});

	test("below min rejected", () => {
		const r = coerceParamInput(numParam({ min: 1 }), "0");
		expect(r).toEqual({ ok: false, error: "The minimum is 1." });
	});

	test("above max rejected", () => {
		const r = coerceParamInput(numParam({ min: 1, max: 15 }), "20");
		expect(r).toEqual({ ok: false, error: "The maximum is 15." });
	});

	test("percent input divides by 100 and ranges in percent terms", () => {
		expect(
			coerceParamInput(
				numParam({ int: false, min: 0, max: 1, percent: true }),
				"50",
			),
		).toEqual({ ok: true, value: 0.5 });
		expect(
			coerceParamInput(
				numParam({ int: false, min: 0, max: 1, percent: true }),
				"150",
			),
		).toEqual({ ok: false, error: "The maximum is 100%." });
	});

	test("empty / non-numeric rejected", () => {
		expect(coerceParamInput(numParam({}), "").ok).toBe(false);
		expect(coerceParamInput(numParam({}), "abc").ok).toBe(false);
	});

	test("enum accepts only its options", () => {
		const p: RuleParam = {
			key: "m",
			label: "m",
			kind: "enum",
			options: ["a", "b"],
			default: "a",
		};
		expect(coerceParamInput(p, "a")).toEqual({ ok: true, value: "a" });
		expect(coerceParamInput(p, "z").ok).toBe(false);
	});

	test("string passes through", () => {
		const p: RuleParam = { key: "s", label: "s", kind: "string" };
		expect(coerceParamInput(p, "hello")).toEqual({ ok: true, value: "hello" });
	});
});
