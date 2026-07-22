import { describe, expect, test } from "bun:test";
import type { SignalRule } from "./client.ts";
import {
	between,
	equals,
	has,
	matches,
	noneOf,
	not,
	oneOf,
	under,
} from "./comparison.ts";
import {
	evaluateComparison,
	evaluateSignalRule,
	SignalEvaluationError,
} from "./evaluate.ts";

const NOW = "2026-07-21T12:00:00.000Z";

function numberRule(comparison: {
	kind: string;
	args: readonly unknown[];
}): SignalRule {
	return {
		name: "n",
		signal: { id: "contributor.accountAge" },
		comparison,
		severity: "low",
	};
}

describe("numeric path", () => {
	test("verbs", () => {
		const run = (cmp: { kind: string; args: readonly unknown[] }, v: number) =>
			evaluateSignalRule(numberRule(cmp), { value: v, now: NOW }).passed;
		expect(run(under(7), 3)).toBe(true);
		expect(run(under(7), 7)).toBe(false);
		expect(run(between(2, 4), 4)).toBe(true);
		expect(run(between(2, 4), 5)).toBe(false);
		expect(run(equals(3), 3)).toBe(true);
		expect(run(not(under(7)), 9)).toBe(true);
		expect(run(oneOf([1, 2, 3]), 2)).toBe(true);
		expect(run(noneOf([1, 2, 3]), 2)).toBe(false);
	});

	test("a text verb on a number signal fails loudly, never coerces", () => {
		expect(() =>
			evaluateSignalRule(numberRule(matches(/x/)), { value: 3, now: NOW }),
		).toThrow(SignalEvaluationError);
	});

	test("a value that contradicts the declared kind fails loudly", () => {
		expect(() =>
			evaluateSignalRule(numberRule(under(7)), { value: "3", now: NOW }),
		).toThrow("declared number but produced string");
	});
});

describe("text and boolean paths", () => {
	test("text verbs", () => {
		expect(
			evaluateComparison("text", "hello world", matches(/world/), "s"),
		).toBe(true);
		expect(evaluateComparison("text", "hello", has("ell"), "s")).toBe(true);
		expect(evaluateComparison("text", "a", oneOf(["a", "b"]), "s")).toBe(true);
		expect(evaluateComparison("text", "c", noneOf(["a", "b"]), "s")).toBe(true);
		expect(evaluateComparison("text", "x", not(has("x")), "s")).toBe(false);
	});

	test("boolean verbs", () => {
		expect(evaluateComparison("boolean", true, equals(true), "s")).toBe(true);
		expect(evaluateComparison("boolean", false, not(equals(true)), "s")).toBe(
			true,
		);
	});
});

describe("windowed transforms", () => {
	const times = [
		"2026-07-21T10:00:00.000Z",
		"2026-07-21T02:00:00.000Z",
		"2026-07-15T12:00:00.000Z",
		"2026-06-25T12:00:00.000Z",
	];

	function windowedRule(
		transform: { kind: "last" | "lastCount"; window: "24h" | "7d" | "30d" },
		comparison: { kind: string; args: readonly unknown[] },
	): SignalRule {
		return {
			name: "w",
			signal: { id: "contributor.recentChangeRequestTimes", transform },
			comparison,
			severity: "low",
		};
	}

	test("lastCount narrows the wide history to the window", () => {
		const passed = (window: "24h" | "7d" | "30d", limit: number) =>
			evaluateSignalRule(
				windowedRule({ kind: "lastCount", window }, under(limit)),
				{ value: times, now: NOW },
			).passed;
		// 24h holds 2 of the 4, 7d holds 3, 30d holds all 4.
		expect(passed("24h", 3)).toBe(true);
		expect(passed("7d", 3)).toBe(false);
		expect(passed("30d", 5)).toBe(true);
		expect(passed("30d", 4)).toBe(false);
	});

	test("a timestamps signal without a transform has no comparison path", () => {
		const rule: SignalRule = {
			name: "t",
			signal: { id: "contributor.recentChangeRequestTimes" },
			comparison: under(3),
			severity: "low",
		};
		expect(() => evaluateSignalRule(rule, { value: times, now: NOW })).toThrow(
			"no comparison applies to timestamps signals yet",
		);
	});

	test("a stored window wider than the signal's history fails, never truncates silently", () => {
		const rule: SignalRule = {
			name: "w",
			signal: {
				id: "contributor.recentChangeRequestTimes",
				// biome-ignore lint/suspicious/noExplicitAny: simulates a stored rule that bypassed authoring checks
				transform: { kind: "lastCount", window: "90d" as any },
			},
			comparison: under(3),
			severity: "low",
		};
		expect(() => evaluateSignalRule(rule, { value: times, now: NOW })).toThrow(
			"asks for more than it can answer",
		);
	});

	test("resolvedValue is the post-transform value the comparison read", () => {
		const rule = windowedRule({ kind: "lastCount", window: "24h" }, under(3));
		const result = evaluateSignalRule(rule, { value: times, now: NOW });
		expect(result.resolvedValue).toBe(2);
	});

	test("unparseable timestamps drop out instead of poisoning the count", () => {
		const rule = windowedRule({ kind: "lastCount", window: "24h" }, equals(1));
		expect(
			evaluateSignalRule(rule, {
				value: ["garbage", "2026-07-21T11:00:00.000Z"],
				now: NOW,
			}).passed,
		).toBe(true);
	});
});
