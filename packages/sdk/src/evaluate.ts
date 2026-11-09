import {
	sdkBooleanValueSchema,
	sdkInnerComparisonSchema,
	sdkListArgumentSchema,
	sdkNumberArgumentSchema,
	sdkNumberValueSchema,
	sdkProducedTypeSchema,
	sdkRegexArgumentSchema,
	sdkScanMatchesSchema,
	sdkScanPatternsSchema,
	sdkStringListSchema,
	sdkTextMapSchema,
	sdkTextValueSchema,
} from "@tripwire/contracts";
import type { SignalRef, SignalRule } from "./client.ts";
import type { SerializedComparison } from "./comparison.ts";
import { globMatch } from "./glob.ts";
import { registry } from "./registry.ts";
import { type ScanMatch, type ScanPattern, scanTextMap } from "./scan.ts";
import type { SignalKind } from "./signal.ts";
import { nonLatinScan } from "./text-metrics.ts";
import { windowMs } from "./window.ts";

export class SignalEvaluationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SignalEvaluationError";
	}
}

function fail(message: string): never {
	throw new SignalEvaluationError(message);
}

function asNumber(
	value: Parameters<typeof sdkNumberValueSchema.safeParse>[0],
	id: string,
): number {
	const parsed = sdkNumberValueSchema.safeParse(value);
	if (!parsed.success) {
		fail(
			`signal ${id} declared number but produced ${sdkProducedTypeSchema.parse(value)}`,
		);
	}
	return parsed.data;
}

function asText(
	value: Parameters<typeof sdkTextValueSchema.safeParse>[0],
	id: string,
): string {
	const parsed = sdkTextValueSchema.safeParse(value);
	if (!parsed.success) {
		fail(
			`signal ${id} declared text but produced ${sdkProducedTypeSchema.parse(value)}`,
		);
	}
	return parsed.data;
}

function asBoolean(
	value: Parameters<typeof sdkBooleanValueSchema.safeParse>[0],
	id: string,
): boolean {
	const parsed = sdkBooleanValueSchema.safeParse(value);
	if (!parsed.success) {
		fail(
			`signal ${id} declared boolean but produced ${sdkProducedTypeSchema.parse(value)}`,
		);
	}
	return parsed.data;
}

function asTextMap(
	value: Parameters<typeof sdkTextMapSchema.safeParse>[0],
	id: string,
) {
	const parsed = sdkTextMapSchema.safeParse(value);
	if (!parsed.success) {
		fail(`signal ${id} declared textMap but produced something else`);
	}
	return parsed.data;
}

function asScanMatches(
	value: Parameters<typeof sdkScanMatchesSchema.safeParse>[0],
	id: string,
): readonly ScanMatch[] {
	const parsed = sdkScanMatchesSchema.safeParse(value);
	if (!parsed.success) {
		fail(`signal ${id} resolved to scanMatches but the list is malformed`);
	}
	return parsed.data;
}

function scanPatternsArg(
	patterns: Parameters<typeof sdkScanPatternsSchema.safeParse>[0],
	id: string,
): readonly ScanPattern[] {
	const parsed = sdkScanPatternsSchema.safeParse(patterns);
	if (!parsed.success) {
		fail(`signal ${id} has a scan transform with malformed patterns`);
	}
	return parsed.data;
}

function asStringList(
	value: Parameters<typeof sdkStringListSchema.safeParse>[0],
	id: string,
	kind: string,
): string[] {
	const parsed = sdkStringListSchema.safeParse(value);
	if (!parsed.success) {
		fail(`signal ${id} declared ${kind} but produced a non string list`);
	}
	return parsed.data;
}

function numberArg(comparison: SerializedComparison, index: number): number {
	const parsed = sdkNumberArgumentSchema.safeParse(comparison.args[index]);
	if (!parsed.success) {
		fail(`comparison ${comparison.kind} needs a number argument`);
	}
	return parsed.data;
}

function textArg(comparison: SerializedComparison): string {
	const parsed = sdkTextValueSchema.safeParse(comparison.args[0]);
	if (!parsed.success) {
		fail(`comparison ${comparison.kind} needs a text argument`);
	}
	return parsed.data;
}

function booleanArg(comparison: SerializedComparison): boolean {
	const parsed = sdkBooleanValueSchema.safeParse(comparison.args[0]);
	if (!parsed.success) {
		fail(`comparison ${comparison.kind} needs a boolean argument`);
	}
	return parsed.data;
}

function regexArg(comparison: SerializedComparison): RegExp {
	const parsed = sdkRegexArgumentSchema.safeParse(comparison.args[0]);
	if (!parsed.success) {
		fail(`comparison ${comparison.kind} needs a regular expression argument`);
	}
	return parsed.data;
}

function listArg(comparison: SerializedComparison): readonly unknown[] {
	const parsed = sdkListArgumentSchema.safeParse(comparison.args[0]);
	if (!parsed.success) {
		fail(`comparison ${comparison.kind} needs a list argument`);
	}
	return parsed.data;
}

function innerComparison(
	comparison: SerializedComparison,
): SerializedComparison {
	const parsed = sdkInnerComparisonSchema.safeParse(comparison.args[0]);
	if (!parsed.success) {
		fail("comparison not needs an inner comparison argument");
	}
	return parsed.data;
}

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
		case "startsWith":
			return value.startsWith(textArg(comparison));
		case "endsWith":
			return value.endsWith(textArg(comparison));
		case "containsAny":
			return listArg(comparison).some((needle) => {
				const parsed = sdkTextValueSchema.safeParse(needle);
				return parsed.success && value.includes(parsed.data);
			});
		case "equals":
			return value === textArg(comparison);
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

function compareScanMatches(
	value: readonly ScanMatch[],
	comparison: SerializedComparison,
): boolean {
	switch (comparison.kind) {
		case "empty":
			return value.length === 0;
		case "not":
			return !compareScanMatches(value, innerComparison(comparison));
		default:
			fail(`comparison ${comparison.kind} does not apply to scanned signals`);
	}
}

function compareBoolean(
	value: boolean,
	comparison: SerializedComparison,
): boolean {
	switch (comparison.kind) {
		case "equals":
			return value === booleanArg(comparison);
		case "not":
			return !compareBoolean(value, innerComparison(comparison));
		default:
			fail(`comparison ${comparison.kind} does not apply to boolean signals`);
	}
}

function globsArg(comparison: SerializedComparison): readonly string[] {
	const parsed = sdkStringListSchema.safeParse(comparison.args[0]);
	if (!parsed.success) {
		fail(`comparison ${comparison.kind} needs a list of glob patterns`);
	}
	return parsed.data;
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
		case "anyIn": {
			const members = listArg(comparison);
			return value.some((entry) => members.includes(entry));
		}
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
	value: ResolvedSignalValue["value"],
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
		case "scanMatches":
			return compareScanMatches(asScanMatches(value, signalId), comparison);
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
	if (ref.transform.kind === "nonLatinRatio") {
		if (kind !== "text") {
			fail(`signal ${ref.id} is ${kind}; nonLatinRatio needs a text signal`);
		}
		return { kind: "number", value: nonLatinScan(asText(raw, ref.id)).ratio };
	}
	if (ref.transform.kind === "letterCount") {
		if (kind !== "text") {
			fail(`signal ${ref.id} is ${kind}; letterCount needs a text signal`);
		}
		return { kind: "number", value: nonLatinScan(asText(raw, ref.id)).letters };
	}
	if (ref.transform.kind === "scan") {
		if (kind !== "textMap") {
			fail(`signal ${ref.id} is ${kind}; scan needs a textMap signal`);
		}
		return {
			kind: "scanMatches",
			value: scanTextMap(
				asTextMap(raw, ref.id),
				scanPatternsArg(ref.transform.patterns, ref.id),
			),
		};
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

interface SignalRuleEvaluation {
	passed: boolean;
	resolvedValue: unknown;
}

/**
 * `now` is the evaluation clock; `resolvedValue` is the post-transform value
 * the comparison read, so evidence never recomputes the verdict's inputs.
 */
export function evaluateSignalRule(
	rule: SignalRule,
	input: { value: unknown; now: string },
): SignalRuleEvaluation {
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
