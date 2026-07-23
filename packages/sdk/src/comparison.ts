import type { ScanMatch } from "./scan.ts";

/**
 * The comparison vocabulary. Each verb is typed to the signal value types it
 * is valid for; a wrong pairing (matches on a number signal, under on a text
 * signal) is a compile error. The phantom is invariant and named so the
 * error message says what actually went wrong.
 */

export interface Comparison<T> {
	readonly kind: string;
	readonly args: readonly unknown[];
	/** Phantom only. Never set at runtime; it carries T invariantly. */
	readonly "~signalValueType"?: (value: T) => T;
}

/** The inert, serializable form a rule carries: verb name plus arguments. */
export interface SerializedComparison {
	readonly kind: string;
	readonly args: readonly unknown[];
}

export function under(limit: number): Comparison<number> {
	return { kind: "under", args: [limit] };
}

export function over(limit: number): Comparison<number> {
	return { kind: "over", args: [limit] };
}

export function atLeast(limit: number): Comparison<number> {
	return { kind: "atLeast", args: [limit] };
}

export function atMost(limit: number): Comparison<number> {
	return { kind: "atMost", args: [limit] };
}

/** Inclusive on both ends. */
export function between(min: number, max: number): Comparison<number> {
	return { kind: "between", args: [min, max] };
}

export function equals(value: number): Comparison<number>;
export function equals(value: string): Comparison<string>;
export function equals(value: boolean): Comparison<boolean>;
export function equals(value: number | string | boolean): {
	kind: string;
	args: readonly unknown[];
} {
	return { kind: "equals", args: [value] };
}

/** For scanned signals: true when the scan found nothing. */
export function empty(): Comparison<readonly ScanMatch[]> {
	return { kind: "empty", args: [] };
}

export function not<T>(comparison: Comparison<T>): Comparison<T> {
	return {
		kind: "not",
		args: [{ kind: comparison.kind, args: comparison.args }],
	};
}

export function matches(pattern: RegExp): Comparison<string> {
	return { kind: "matches", args: [pattern] };
}

/** True when the text contains the needle. */
export function has(needle: string): Comparison<string> {
	return { kind: "has", args: [needle] };
}

/** True when the text contains any needle in the list. Plain substring, no regex. */
export function containsAny(needles: readonly string[]): Comparison<string> {
	return { kind: "containsAny", args: [needles] };
}

export function oneOf(values: readonly string[]): Comparison<string>;
export function oneOf(values: readonly number[]): Comparison<number>;
export function oneOf(values: readonly string[] | readonly number[]): {
	kind: string;
	args: readonly unknown[];
} {
	return { kind: "oneOf", args: [values] };
}

/**
 * For list signals: true when no entry matches any of the glob patterns.
 * `*` spans within a path segment, `**` spans segments.
 */
export function noneMatch(
	globs: readonly string[],
): Comparison<readonly string[]> {
	return { kind: "noneMatch", args: [globs] };
}

export function noneOf(values: readonly string[]): Comparison<string>;
export function noneOf(values: readonly number[]): Comparison<number>;
export function noneOf(values: readonly string[] | readonly number[]): {
	kind: string;
	args: readonly unknown[];
} {
	return { kind: "noneOf", args: [values] };
}

/**
 * For list signals: true when any entry equals a member of the list. Exact-match
 * membership, the textList analog of oneOf; non-empty intersection.
 */
export function anyIn(
	values: readonly string[],
): Comparison<readonly string[]> {
	return { kind: "anyIn", args: [values] };
}
