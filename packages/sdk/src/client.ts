import type { Comparison, SerializedComparison } from "./comparison.ts";
import type { AnyForgeDefinition } from "./forge.ts";
import {
	registry,
	type SignalId,
	type SignalTree,
	signalTree,
} from "./registry.ts";
import type { ScanMatch, ScanPattern } from "./scan.ts";
import type { AnySignal, SignalValueType, t } from "./signal.ts";
import { type WindowSpec, type WindowWithin, windowMs } from "./window.ts";

/**
 * The Tripwire client. `forge` is the type provider: binding it narrows the
 * signal surface to the forge's producers, and the narrowing survives
 * `export const { rule, signals } = tripwire`. `apiKey` authenticates the
 * program to Tripwire's API for APPLYING rules; authoring needs no key and
 * makes no network calls.
 */

/** How a rule refers to a signal: the id plus an optional transform. */
export interface SignalRef {
	readonly id: SignalId;
	readonly transform?:
		| { readonly kind: "last"; readonly window: WindowSpec }
		| { readonly kind: "lastCount"; readonly window: WindowSpec }
		| { readonly kind: "trimmedLength" }
		| { readonly kind: "nonLatinRatio" }
		| { readonly kind: "letterCount" }
		/** Patterns are live trusted data at evaluation time; a serialized form
		 * arrives only if user-authored patterns ever ship, with its own gate. */
		| { readonly kind: "scan"; readonly patterns: readonly ScanPattern[] };
}

/**
 * A signal as exposed on a bound client's surface. The `~forge` phantom ties
 * it to the forge it came from: a raw registry signal (no brand) and a
 * signal bound to a different forge are both compile errors in `rule()`.
 */
export interface BoundSignal<T, FId extends string> {
	readonly ref: SignalRef;
	/** The runtime type of the value this signal yields, after any transform. */
	readonly valueType: SignalValueType<T, string>;
	readonly describe: string;
	/** Phantom only. Never set at runtime; it pins the owning forge. */
	readonly "~forge"?: (forge: FId) => FId;
}

export interface WindowedTimestampsSignal<FId extends string>
	extends BoundSignal<readonly string[], FId> {
	/** How many timestamps fall inside the window, as a number signal. */
	readonly count: BoundSignal<number, FId>;
}

export interface TimestampsBoundSignal<
	FId extends string,
	H extends WindowSpec | undefined,
> extends BoundSignal<readonly string[], FId> {
	/**
	 * Narrow to the last `window`. Reads from the signal's wide history. A
	 * LITERAL window wider than the signal's declared history is a COMPILE
	 * error; a dynamic window is checked when the rule is defined.
	 */
	last<W extends WindowSpec>(
		window: W & WindowWithin<W, H>,
	): WindowedTimestampsSignal<FId>;
}

export interface TextBoundSignal<FId extends string>
	extends BoundSignal<string, FId> {
	/** The text's length after trimming surrounding whitespace. */
	readonly trimmedLength: BoundSignal<number, FId>;
	/** The ratio of non-Latin letters among all letters in the text. */
	readonly nonLatinRatio: BoundSignal<number, FId>;
	/** How many letters the text contains. */
	readonly letterCount: BoundSignal<number, FId>;
}

export interface TextMapBoundSignal<FId extends string>
	extends BoundSignal<Readonly<Record<string, string>>, FId> {
	/** Derive the list of pattern matches, keyed by where each was found. */
	scan(
		patterns: readonly ScanPattern[],
	): BoundSignal<readonly ScanMatch[], FId>;
}

export type SupportedIds<F> = F extends { produces: infer P }
	? keyof P & SignalId
	: never;

export type ForgeIdOf<F> = F extends { id: infer Id extends string }
	? Id
	: never;

type HistoryOf<S> = S extends { history?: infer H }
	? [Extract<H, WindowSpec>] extends [never]
		? undefined
		: Extract<H, WindowSpec>
	: undefined;

type BoundFor<S, FId extends string> = S extends {
	type: SignalValueType<infer T, infer K>;
}
	? K extends "timestamps"
		? TimestampsBoundSignal<FId, HistoryOf<S>>
		: K extends "text"
			? TextBoundSignal<FId>
			: K extends "textMap"
				? TextMapBoundSignal<FId>
				: BoundSignal<T, FId>
	: never;

/** The forge-narrowed surface: signals.<scope>.<name>, producers only. */
export type ForgeSignals<F> = {
	[Scope in keyof SignalTree]: {
		[Name in keyof SignalTree[Scope] as SignalTree[Scope][Name] extends {
			id: SupportedIds<F>;
		}
			? Name
			: never]: BoundFor<SignalTree[Scope][Name], ForgeIdOf<F>>;
	};
};

export type Severity = "low" | "medium" | "high";

/** Rule output: pure, keyless, network-free data. */
export interface SignalRule {
	readonly name: string;
	readonly signal: SignalRef;
	readonly comparison: SerializedComparison;
	readonly severity: Severity;
}

export type RuleFactory<F> = <T>(
	name: string,
	def: {
		when: BoundSignal<T, ForgeIdOf<F>>;
		comparison: NoInfer<Comparison<T>>;
		severity: Severity;
	},
) => SignalRule;

const NUMBER_TYPE: SignalValueType<number, "number"> = { kind: "number" };

const SCAN_MATCHES_TYPE: SignalValueType<readonly ScanMatch[], "scanMatches"> =
	{ kind: "scanMatches" };

function bindSignal(signal: AnySignal): Record<string, unknown> {
	const base = {
		ref: { id: signal.id as SignalId },
		valueType: signal.type,
		describe: signal.describe,
	};
	if (signal.type.kind === "text") {
		const metric = (
			kind: "trimmedLength" | "nonLatinRatio" | "letterCount",
			describe: string,
		) => ({
			ref: { id: signal.id as SignalId, transform: { kind } },
			valueType: NUMBER_TYPE,
			describe,
		});
		return {
			...base,
			trimmedLength: metric(
				"trimmedLength",
				`${signal.describe}, as its length without surrounding whitespace`,
			),
			nonLatinRatio: metric(
				"nonLatinRatio",
				`${signal.describe}, as the ratio of non-Latin letters among its letters`,
			),
			letterCount: metric(
				"letterCount",
				`${signal.describe}, as how many letters it contains`,
			),
		};
	}
	if (signal.type.kind === "textMap") {
		return {
			...base,
			scan(patterns: readonly ScanPattern[]): Record<string, unknown> {
				return {
					ref: {
						id: signal.id as SignalId,
						transform: { kind: "scan", patterns },
					},
					valueType: SCAN_MATCHES_TYPE,
					describe: `${signal.describe}, scanned for pattern matches`,
				};
			},
		};
	}
	if (signal.type.kind !== "timestamps") {
		return base;
	}
	return {
		...base,
		last(window: WindowSpec): Record<string, unknown> {
			const history = signal.history;
			if (history === undefined || windowMs(window) > windowMs(history)) {
				throw new Error(
					`signal ${signal.id} provides ${history ?? "no"} history; ` +
						`.last("${window}") asks for more than it can answer`,
				);
			}
			return {
				ref: { id: signal.id as SignalId, transform: { kind: "last", window } },
				valueType: signal.type,
				describe: `${signal.describe}, narrowed to the last ${window}`,
				count: {
					ref: {
						id: signal.id as SignalId,
						transform: { kind: "lastCount", window },
					},
					valueType: NUMBER_TYPE satisfies typeof t.number,
					describe: `How many of these fall in the last ${window}`,
				},
			};
		},
	};
}

function buildSignals(produces: Record<string, unknown>) {
	const out: Record<string, Record<string, unknown>> = {};
	const tree = signalTree as Record<string, Record<string, AnySignal>>;
	for (const [scope, group] of Object.entries(tree)) {
		out[scope] = {};
		for (const [name, signal] of Object.entries(group)) {
			if (signal.id in produces) {
				out[scope][name] = bindSignal(signal);
			}
		}
	}
	return out;
}

export class Tripwire<F extends AnyForgeDefinition> {
	readonly signals: ForgeSignals<F>;
	readonly apiKey: string | undefined;

	constructor(opts: { forge: F; apiKey?: string }) {
		this.apiKey = opts.apiKey;
		this.signals = buildSignals(opts.forge.produces) as ForgeSignals<F>;
	}

	/**
	 * Defines a rule: a signal, a comparison, a severity. Pure data out; no
	 * network, no key needed. Arrow property so destructuring keeps it working.
	 */
	readonly rule: RuleFactory<F> = (name, def) => {
		if (!(def.when.ref.id in registry)) {
			throw new Error(`unknown signal "${def.when.ref.id}"`);
		}
		return {
			name,
			signal: def.when.ref,
			comparison: { kind: def.comparison.kind, args: def.comparison.args },
			severity: def.severity,
		};
	};
}
