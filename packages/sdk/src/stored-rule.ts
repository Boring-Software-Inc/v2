import { registry } from "./registry.ts";
import type { SignalKind } from "./signal.ts";
import { type WindowSpec, windowMs } from "./window.ts";

/**
 * Author-time validation for a data-defined rule, mirroring what the
 * evaluator enforces at run time: the signal exists, the transform fits the
 * signal's kind and history, and the verb applies to the compared kind.
 * Returns one plain sentence, or null when the rule is sound. The evaluator
 * remains the trust boundary; this exists so the builder and the write path
 * reject bad rules before they store.
 */

const VERBS_FOR_KIND: Partial<Record<SignalKind, readonly string[]>> = {
	number: [
		"under",
		"over",
		"atLeast",
		"atMost",
		"between",
		"equals",
		"oneOf",
		"noneOf",
		"not",
	],
	text: [
		"equals",
		"has",
		"startsWith",
		"endsWith",
		"containsAny",
		"oneOf",
		"noneOf",
		"not",
	],
	boolean: ["equals", "not"],
	textList: ["noneMatch", "anyIn", "not"],
};

const LIST_VERBS = new Set([
	"oneOf",
	"noneOf",
	"containsAny",
	"noneMatch",
	"anyIn",
]);

/**
 * The arg-type gate, derived from the compared kind — the type flow one step
 * past the verb check. A number verb must carry numbers, a list verb a
 * non-empty list of the right element type, a boolean verb a boolean. Rejected
 * with a plain message, never coerced. Mirrors the evaluator's arg validators
 * so the write path fails on save, not at run time.
 */
function argIssue(
	kind: SignalKind,
	comparison: { kind: string; args: readonly unknown[] },
): string | null {
	const verb = comparison.kind;
	const args = comparison.args;
	if (verb === "not") {
		const inner = args[0];
		if (
			typeof inner !== "object" ||
			inner === null ||
			typeof (inner as { kind?: unknown }).kind !== "string" ||
			!Array.isArray((inner as { args?: unknown }).args)
		) {
			return "this rule is missing the comparison it negates";
		}
		return argIssue(kind, inner as { kind: string; args: readonly unknown[] });
	}
	if (kind === "boolean") {
		return typeof args[0] === "boolean"
			? null
			: "an on or off signal takes a yes or no value";
	}
	const wantNumber = kind === "number";
	if (verb === "between") {
		return typeof args[0] === "number" && typeof args[1] === "number"
			? null
			: "this comparison needs a low and a high number";
	}
	if (LIST_VERBS.has(verb)) {
		const list = args[0];
		if (!Array.isArray(list) || list.length === 0) {
			return "add at least one value";
		}
		const good = list.every(
			(entry) => typeof entry === (wantNumber ? "number" : "string"),
		);
		return good
			? null
			: wantNumber
				? "each value must be a number"
				: "each value must be text";
	}
	if (wantNumber) {
		return typeof args[0] === "number" ? null : "this signal takes a number";
	}
	return typeof args[0] === "string" ? null : "this signal takes text";
}

interface StoredRuleData {
	when: {
		id: string;
		transform?: { kind: string; window?: string };
	};
	comparison: { kind: string; args: readonly unknown[] };
}

export function storedRuleIssue(rule: StoredRuleData): string | null {
	const signal = (
		registry as Record<string, { type: { kind: string }; history?: WindowSpec }>
	)[rule.when.id];
	if (!signal) {
		return `unknown signal ${rule.when.id}`;
	}
	let comparedKind = signal.type.kind as SignalKind;
	const transform = rule.when.transform;
	if (transform) {
		if (transform.kind === "lastCount" || transform.kind === "last") {
			if (comparedKind !== "timestamps") {
				return "only rate signals take a time window";
			}
			if (!transform.window || !/^\d+(h|d)$/.test(transform.window)) {
				return "the window needs a count and a unit, like 24h or 7d";
			}
			const history = signal.history;
			if (
				history === undefined ||
				windowMs(transform.window as WindowSpec) > windowMs(history)
			) {
				return `this signal only provides ${history ?? "no"} history`;
			}
			comparedKind = transform.kind === "lastCount" ? "number" : "timestamps";
		} else if (
			transform.kind === "trimmedLength" ||
			transform.kind === "nonLatinRatio" ||
			transform.kind === "letterCount"
		) {
			if (comparedKind !== "text") {
				return `the ${transform.kind} transform needs a text signal`;
			}
			comparedKind = "number";
		} else {
			return `unknown transform ${transform.kind}`;
		}
	}
	if (comparedKind === "timestamps") {
		return "rate signals compare through a window count, like the last 24h";
	}
	const verbs = VERBS_FOR_KIND[comparedKind];
	if (!verbs?.includes(rule.comparison.kind)) {
		return `${rule.comparison.kind} does not apply to this signal`;
	}
	return argIssue(comparedKind, rule.comparison);
}
