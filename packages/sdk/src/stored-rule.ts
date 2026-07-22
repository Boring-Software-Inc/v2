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
	text: ["equals", "has", "oneOf", "noneOf", "not"],
	boolean: ["equals", "not"],
	textList: ["noneMatch", "not"],
};

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
	return null;
}
