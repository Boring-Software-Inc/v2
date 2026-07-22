import type { SignalRef, SignalRule } from "./client.ts";
import type { SerializedComparison } from "./comparison.ts";
import { globMatch } from "./glob.ts";
import { registry } from "./registry.ts";
import type { SignalKind } from "./signal.ts";
import { windowMs } from "./window.ts";

/**
 * Evaluation-time type safety. The evaluator iterates signals generically,
 * so a produced value arrives as `unknown`. Before ANY comparison reads it,
 * the value is re-narrowed through a discriminated dispatch on the signal's
 * runtime `type.kind`. There is no bare `value as T` anywhere on this path:
 * every cast sits directly behind the typeof / Array.isArray check that
 * proves it. A mismatch between a producer's value and its declared kind is
 * a bug, and throws.
 */

export class SignalEvaluationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SignalEvaluationError";
	}
}

function fail(message: string): never {
	throw new SignalEvaluationError(message);
}

// --- runtime re-narrowing: one guard per signal kind -------------------------

function asNumber(value: unknown, id: string): number {
	if (typeof value !== "number" || Number.isNaN(value)) {
		fail(`signal ${id} declared number but produced ${typeof value}`);
	}
	return value;
}

function asText(value: unknown, id: string): string {
	if (typeof value !== "string") {
		fail(`signal ${id} declared text but produced ${typeof value}`);
	}
	return value;
}

function asBoolean(value: unknown, id: string): boolean {
	if (typeof value !== "boolean") {
		fail(`signal ${id} declared boolean but produced ${typeof value}`);
	}
	return value;
}

function asStringList(value: unknown, id: string, kind: string): string[] {
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== "string")
	) {
		fail(`signal ${id} declared ${kind} but produced a non string list`);
	}
	return value as string[];
}

// --- comparison arguments are unknown too; validate before use ---------------

function numberArg(comparison: SerializedComparison, index: number): number {
	const arg = comparison.args[index];
	if (typeof arg !== "number") {
		fail(`comparison ${comparison.kind} needs a number argument`);
	}
	return arg;
}

function textArg(comparison: SerializedComparison): string {
	const arg = comparison.args[0];
	if (typeof arg !== "string") {
		fail(`comparison ${comparison.kind} needs a text argument`);
	}
	return arg;
}

function regexArg(comparison: SerializedComparison): RegExp {
	const arg = comparison.args[0];
	if (!(arg instanceof RegExp)) {
		fail(`comparison ${comparison.kind} needs a regular expression argument`);
	}
	return arg;
}

function listArg(comparison: SerializedComparison): readonly unknown[] {
	const arg = comparison.args[0];
	if (!Array.isArray(arg)) {
		fail(`comparison ${comparison.kind} needs a list argument`);
	}
	return arg;
}

function innerComparison(
	comparison: SerializedComparison,
): SerializedComparison {
	const arg = comparison.args[0];
	if (
		typeof arg !== "object" ||
		arg === null ||
		typeof (arg as { kind?: unknown }).kind !== "string" ||
		!Array.isArray((arg as { args?: unknown }).args)
	) {
		fail("comparison not needs an inner comparison argument");
	}
	return arg as SerializedComparison;
}

// --- per-kind comparison paths -----------------------------------------------

function compareNumber(
	value: number,
	comparison: SerializedComparison,
): boolean {
	switch (comparison.kind) {
		case "under":
			return value < numberArg(comparison, 0);
		case "over":
			return value > numberArg(comparison, 0);
		case "atLeast":
			return value >= numberArg(comparison, 0);
		case "atMost":
			return value <= numberArg(comparison, 0);
		case "between":
			return (
				value >= numberArg(comparison, 0) && value <= numberArg(comparison, 1)
			);
		case "equals":
			return value === numberArg(comparison, 0);
		case "oneOf":
			return listArg(comparison).includes(value);
		case "noneOf":
			return !listArg(comparison).includes(value);
		case "not":
			return !compareNumber(value, innerComparison(comparison));
		default:
			fail(`comparison ${comparison.kind} does not apply to number signals`);
	}
}

function compareText(value: string, comparison: SerializedComparison): boolean {
	switch (comparison.kind) {
		case "matches":
			return regexArg(comparison).test(value);
		case "has":
			return value.includes(textArg(comparison));
		case "equals":
			return value === comparison.args[0];
		case "oneOf":
			return listArg(comparison).includes(value);
		case "noneOf":
			return !listArg(comparison).includes(value);
		case "not":
			return !compareText(value, innerComparison(comparison));
		default:
			fail(`comparison ${comparison.kind} does not apply to text signals`);
	}
}

function compareBoolean(
	value: boolean,
	comparison: SerializedComparison,
): boolean {
	switch (comparison.kind) {
		case "equals":
			return value === comparison.args[0];
		case "not":
			return !compareBoolean(value, innerComparison(comparison));
		default:
			fail(`comparison ${comparison.kind} does not apply to boolean signals`);
	}
}

function globsArg(comparison: SerializedComparison): readonly string[] {
	const arg = comparison.args[0];
	if (!Array.isArray(arg) || arg.some((glob) => typeof glob !== "string")) {
		fail(`comparison ${comparison.kind} needs a list of glob patterns`);
	}
	return arg as string[];
}

function compareTextList(
	value: readonly string[],
	comparison: SerializedComparison,
): boolean {
	switch (comparison.kind) {
		case "noneMatch":
			return !value.some((entry) =>
				globsArg(comparison).some((glob) => globMatch(glob, entry)),
			);
		case "not":
			return !compareTextList(value, innerComparison(comparison));
		default:
			fail(`comparison ${comparison.kind} does not apply to list signals`);
	}
}

/**
 * The signal-value-meets-comparison boundary. `kind` is the runtime
 * discriminant; each comparison verb is reachable only through its matching
 * kind branch.
 */
export function evaluateComparison(
	kind: SignalKind,
	value: unknown,
	comparison: SerializedComparison,
	signalId: string,
): boolean {
	switch (kind) {
		case "number":
			return compareNumber(asNumber(value, signalId), comparison);
		case "text":
			return compareText(asText(value, signalId), comparison);
		case "boolean":
			return compareBoolean(asBoolean(value, signalId), comparison);
		case "textList":
			return compareTextList(asStringList(value, signalId, kind), comparison);
		case "timestamps":
		case "textMap":
			fail(
				`no comparison applies to ${kind} signals yet; ` +
					`use a transform like .last().count where one exists`,
			);
	}
}

export interface ResolvedSignalValue {
	kind: SignalKind;
	value: unknown;
}

/**
 * Applies the rule's transform to the raw produced value. Transforms only
 * exist on text and timestamps signals; inputs are validated before use.
 * Exported so evidence can read the SAME resolution the verdict used, never
 * a hand-rolled copy of the window or trim arithmetic.
 */
export function resolveSignalValue(
	ref: SignalRef,
	input: { value: unknown; now: string },
): ResolvedSignalValue {
	const raw = input.value;
	const now = input.now;
	const signal = registry[ref.id];
	if (!signal) {
		fail(`unknown signal "${ref.id}"`);
	}
	const kind = signal.type.kind as SignalKind;
	if (!ref.transform) {
		return { kind, value: raw };
	}
	if (ref.transform.kind === "trimmedLength") {
		if (kind !== "text") {
			fail(`signal ${ref.id} is ${kind}; trimmedLength needs a text signal`);
		}
		return { kind: "number", value: asText(raw, ref.id).trim().length };
	}
	if (kind !== "timestamps") {
		fail(`signal ${ref.id} is ${kind}; only timestamps signals take windows`);
	}
	const history = signal.history;
	if (
		history === undefined ||
		windowMs(ref.transform.window) > windowMs(history)
	) {
		fail(
			`signal ${ref.id} provides ${history ?? "no"} history; ` +
				`the ${ref.transform.window} window asks for more than it can answer`,
		);
	}
	const cutoff = Date.parse(now) - windowMs(ref.transform.window);
	const inWindow = asStringList(raw, ref.id, kind).filter((time) => {
		const parsed = Date.parse(time);
		return !Number.isNaN(parsed) && parsed >= cutoff;
	});
	return ref.transform.kind === "last"
		? { kind: "timestamps", value: inWindow }
		: { kind: "number", value: inWindow.length };
}

/**
 * Evaluates one rule against the raw value its signal produced. `now` is the
 * evaluation clock, an input, so windowed rules stay deterministic.
 * `resolvedValue` is the post-transform value the comparison actually read
 * (the windowed count, the trimmed length, the raw value when there is no
 * transform), so evidence never recomputes what the verdict derived.
 */
export function evaluateSignalRule(
	rule: SignalRule,
	input: { value: unknown; now: string },
): { passed: boolean; resolvedValue: unknown } {
	const resolved = resolveSignalValue(rule.signal, input);
	return {
		passed: evaluateComparison(
			resolved.kind,
			resolved.value,
			rule.comparison,
			rule.signal.id,
		),
		resolvedValue: resolved.value,
	};
}
