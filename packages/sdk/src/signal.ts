import type { WindowSpec } from "./window.ts";

/**
 * Signals are the forge-neutral facts rules read. A signal's `type` is a
 * RUNTIME value, not just a TS type param, so the registry stays
 * introspectable by the UI and the future AI composer. The phantom on the
 * value type is what carries the static type through the whole chain:
 * registry type -> producer return type -> signal value type -> comparison.
 */

export interface SignalValueType<T, K extends string = string> {
	readonly kind: K;
	/** Phantom only. Never set at runtime; it carries T invariantly. */
	readonly "~signalValueType"?: (value: T) => T;
}

export type SignalKind =
	| "number"
	| "text"
	| "boolean"
	| "textList"
	| "timestamps"
	| "textMap";

/** The SDK's value-type vocabulary. Every registry signal uses one of these. */
export const t = {
	number: { kind: "number" } as SignalValueType<number, "number">,
	text: { kind: "text" } as SignalValueType<string, "text">,
	boolean: { kind: "boolean" } as SignalValueType<boolean, "boolean">,
	/** A list of plain strings, e.g. changed file paths. */
	textList: { kind: "textList" } as SignalValueType<
		readonly string[],
		"textList"
	>,
	/** ISO timestamps, newest first. */
	timestamps: { kind: "timestamps" } as SignalValueType<
		readonly string[],
		"timestamps"
	>,
	/** Text keyed by a location, e.g. diff patch text keyed by file path. */
	textMap: { kind: "textMap" } as SignalValueType<
		Readonly<Record<string, string>>,
		"textMap"
	>,
};

export type SignalScope = "contributor" | "repoRelation" | "pr" | "comment";

export interface Signal<
	Id extends string,
	T,
	K extends string = string,
	H extends WindowSpec | undefined = undefined,
> {
	readonly id: Id;
	readonly scope: SignalScope;
	readonly type: SignalValueType<T, K>;
	readonly describe: string;
	/**
	 * How much history the signal's producers guarantee, for windowed signals.
	 * The signal stays wide; rules narrow with `.last()`. Literal-typed so a
	 * `.last()` window wider than this is a COMPILE error, never silent
	 * truncation.
	 */
	readonly history?: H;
}

/** Structural view of a signal, for runtime iteration and registry checks. */
export interface AnySignal {
	readonly id: string;
	readonly scope: SignalScope;
	readonly type: { readonly kind: string };
	readonly describe: string;
	readonly history?: WindowSpec;
}

export type SignalValue<S> = S extends {
	type: SignalValueType<infer T, string>;
}
	? T
	: never;

export function defineSignal<
	Id extends string,
	T,
	K extends string,
	H extends WindowSpec | undefined = undefined,
>(def: {
	id: Id;
	scope: SignalScope;
	type: SignalValueType<T, K>;
	describe: string;
	history?: H;
}): Signal<Id, T, K, H> {
	return def;
}

/**
 * Thrown by a producer when the fact is honestly absent for this evaluation
 * (no comment on a push event, unparseable upstream data). The evaluation
 * layer turns it into the rule's skip, never a run failure.
 */
export class SignalUnavailableError extends Error {
	constructor(readonly reason: string) {
		super(reason);
		this.name = "SignalUnavailableError";
	}
}

export function signalUnavailable(reason: string): never {
	throw new SignalUnavailableError(reason);
}
