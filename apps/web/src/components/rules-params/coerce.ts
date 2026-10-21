import type { RuleParam } from "@tripwire/contracts";

/** Result of coercing a raw text input into a typed, in-range param value. */
export type Coerced =
	| { ok: true; value: unknown }
	| { ok: false; error: string };

/**
 * Validate + coerce a raw input string for a scalar param at the edit boundary
 * (§9). Numbers parse (percent inputs divide by 100), integers reject fractions,
 * and min/max reject out-of-range BEFORE the value reaches the mutation — the
 * server's `configSchema.safeParse` is the backstop, this is the inline UX. Pure
 * + component-free so it's unit-testable. string-list / boolean are edited
 * structurally (chips / toggle), not through this text path.
 */
export function coerceParamInput(param: RuleParam, raw: string): Coerced {
	if (param.kind === "number") {
		if (raw.trim() === "") {
			return { ok: false, error: "Enter a number." };
		}
		const parsed = Number(raw);
		if (Number.isNaN(parsed)) {
			return { ok: false, error: "Enter a number." };
		}
		const value = param.percent ? parsed / 100 : parsed;
		if (param.int && !Number.isInteger(value)) {
			return { ok: false, error: "Enter a whole number." };
		}
		const show = (n: number) => (param.percent ? `${Math.round(n * 100)}%` : n);
		if (param.min !== undefined && value < param.min) {
			return { ok: false, error: `Enter ${show(param.min)} or more.` };
		}
		if (param.max !== undefined && value > param.max) {
			return { ok: false, error: `Enter ${show(param.max)} or less.` };
		}
		return { ok: true, value };
	}
	if (param.kind === "enum") {
		return param.options.includes(raw)
			? { ok: true, value: raw }
			: { ok: false, error: "Pick an option." };
	}
	// string
	return { ok: true, value: raw };
}
