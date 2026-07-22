/**
 * Time windows for windowed signals: a count and a unit, hours or days.
 * The format is checked at compile time. A LITERAL window is also checked
 * against the signal's declared history at compile time; a dynamic window
 * (built from config at runtime) falls through to the runtime check.
 */

export type WindowSpec = `${number}h` | `${number}d`;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function windowMs(window: WindowSpec): number {
	const match = /^(\d+(?:\.\d+)?)([hd])$/.exec(window);
	if (!match) {
		throw new Error(
			`invalid window "${window}": use a count and a unit, like "24h" or "7d"`,
		);
	}
	const count = Number(match[1]);
	return count * (match[2] === "h" ? HOUR_MS : DAY_MS);
}

// --- compile-time window arithmetic ------------------------------------------
// Tuple-length comparison. Practical bounds: counts up to ~999 per unit; a
// larger literal fails with a depth error, which is still a compile error.

type BuildTuple<
	N extends number,
	T extends unknown[] = [],
> = T["length"] extends N ? T : BuildTuple<N, [...T, unknown]>;

type Lte<A extends number, B extends number> =
	BuildTuple<B> extends [...BuildTuple<A>, ...unknown[]] ? true : false;

type Mul24<N extends number> = [
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
	...BuildTuple<N>,
]["length"] &
	number;

type CountOf<W extends WindowSpec> = W extends `${infer N extends number}h`
	? N
	: W extends `${infer N extends number}d`
		? N
		: never;

/** True when W is built at runtime (its count is `number`, not a literal). */
type IsDynamicWindow<W extends WindowSpec> =
	number extends CountOf<W> ? true : false;

/**
 * Same-unit windows compare their counts directly; mixed units convert the
 * days side to hours. Tuples stay small, so the compile error for an
 * over-window literal is the plain message, not a depth blowup.
 */
type Fits<
	W extends WindowSpec,
	H extends WindowSpec,
> = W extends `${infer WD extends number}d`
	? H extends `${infer HD extends number}d`
		? Lte<WD, HD>
		: H extends `${infer HH extends number}h`
			? Lte<Mul24<WD>, HH>
			: false
	: W extends `${infer WH extends number}h`
		? H extends `${infer HH extends number}h`
			? Lte<WH, HH>
			: H extends `${infer HD extends number}d`
				? Lte<WH, Mul24<HD>>
				: false
		: false;

/**
 * Intersected with the `.last()` parameter: resolves to `unknown` when the
 * window fits (or is dynamic, deferred to the runtime check), and to an
 * error marker object when a literal window exceeds the signal's history.
 * An object, not a string: a string would collapse the intersection to
 * `never` and hide the message from the compile error.
 */
export type WindowWithin<
	W extends WindowSpec,
	H extends WindowSpec | undefined,
> = [H] extends [undefined]
	? { "this signal declares no history, so .last() cannot answer": true }
	: IsDynamicWindow<W> extends true
		? unknown
		: Fits<W, H & WindowSpec> extends true
			? unknown
			: { "this window exceeds the signal's declared history": H };
