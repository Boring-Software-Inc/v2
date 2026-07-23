// Phase 0 typing spike. Throwaway fixture, not real code.
// Proves: (1) comparison constrained to signal value type at compile time,
// (2) forge binding narrows the signal surface, surviving destructure + re-import.

// ---------------------------------------------------------------------------
// Signal value types as RUNTIME values (locked specific #1). The phantom
// carries the static type; the `kind` string is what the UI / AI composer
// introspect.
// ---------------------------------------------------------------------------

export interface SignalValueType<T> {
	readonly kind: string;
	readonly "~value"?: (value: T) => T;
}

export const t = {
	number: { kind: "number" } as SignalValueType<number>,
	text: { kind: "text" } as SignalValueType<string>,
	boolean: { kind: "boolean" } as SignalValueType<boolean>,
};

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export interface Signal<Id extends string, Scope extends string, T> {
	readonly id: Id;
	readonly scope: Scope;
	readonly type: SignalValueType<T>;
	readonly describe: string;
}

export type AnySignal = Signal<string, string, unknown>;
export type ValueOf<S> = S extends Signal<string, string, infer T> ? T : never;

export function defineSignal<Id extends string, Scope extends string, T>(def: {
	id: Id;
	scope: Scope;
	type: SignalValueType<T>;
	describe: string;
}): Signal<Id, Scope, T> {
	return def;
}

export const accountAge = defineSignal({
	id: "contributor.accountAge",
	scope: "contributor",
	type: t.number,
	describe: "Days since the contributor's account was created",
});

export const displayName = defineSignal({
	id: "contributor.displayName",
	scope: "contributor",
	type: t.text,
	describe: "The contributor's display name",
});

export const isFirstContribution = defineSignal({
	id: "pr.isFirstContribution",
	scope: "pr",
	type: t.boolean,
	describe: "True when this is the contributor's first pull request here",
});

// The neutral registry: keyed by signal id (literal-typed), introspectable at
// runtime, and the source of truth the producer map is typed against.
export const registry = {
	[accountAge.id]: accountAge,
	[displayName.id]: displayName,
	[isFirstContribution.id]: isFirstContribution,
};
export type Registry = typeof registry;

// The nested surface shape: signals.<scope>.<name>
export const signalTree = {
	contributor: { accountAge, displayName },
	pr: { isFirstContribution },
};
export type SignalTree = typeof signalTree;

// ---------------------------------------------------------------------------
// Comparisons. Each is typed to the signal value types it is valid for.
// The phantom is invariant (function position) so Comparison<string> and
// Comparison<number> reject each other in both directions.
// ---------------------------------------------------------------------------

export interface Comparison<T> {
	readonly kind: string;
	readonly args: readonly unknown[];
	readonly "~value"?: (value: T) => T;
}

export function under(limit: number): Comparison<number> {
	return { kind: "under", args: [limit] };
}

export function over(limit: number): Comparison<number> {
	return { kind: "over", args: [limit] };
}

export function matches(pattern: RegExp): Comparison<string> {
	return { kind: "matches", args: [pattern] };
}

export function is(expected: boolean): Comparison<boolean> {
	return { kind: "is", args: [expected] };
}

// ---------------------------------------------------------------------------
// Forges. defineForge is credential-free: producers get ctx.forge, an
// already-authenticated native client the backend injects, plus a memoized
// loader for dedupe (locked specifics #2 and #3).
// ---------------------------------------------------------------------------

export interface ForgeCtx<Client> {
	readonly forge: Client;
	load<V>(key: string, fetch: () => Promise<V>): Promise<V>;
}

export type ProducerMap<Client> = {
	[K in keyof Registry]?: (
		ctx: ForgeCtx<Client>,
	) => ValueOf<Registry[K]> | Promise<ValueOf<Registry[K]>>;
};

export interface Forge<Client, P extends ProducerMap<Client>> {
	readonly id: string;
	readonly produces: P;
}

// Curried so Client is explicit while the producer map P stays inferred.
export function defineForge<Client>() {
	return <P extends ProducerMap<Client>>(def: {
		id: string;
		produces: P;
	}): Forge<Client, P> => def;
}

// ---------------------------------------------------------------------------
// Two fake forges: github (full coverage) and forgeJoe (no accountAge
// producer, on purpose).
// ---------------------------------------------------------------------------

export interface GithubClient {
	getUser(login: string): Promise<{ createdAt: string; name: string }>;
	listPulls(repo: string): Promise<{ author: string }[]>;
}

function daysSince(iso: string): number {
	return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export const github = defineForge<GithubClient>()({
	id: "github",
	produces: {
		[accountAge.id]: async (ctx) => {
			const user = await ctx.load("user", () => ctx.forge.getUser("author"));
			return daysSince(user.createdAt);
		},
		[displayName.id]: async (ctx) => {
			// Same loader key as accountAge: one fetch, two signals.
			const user = await ctx.load("user", () => ctx.forge.getUser("author"));
			return user.name;
		},
		[isFirstContribution.id]: async (ctx) => {
			const pulls = await ctx.load("pulls", () => ctx.forge.listPulls("repo"));
			return pulls.length === 0;
		},
	},
});

export interface JoeClient {
	profile(): Promise<{ name: string; prCount: number }>;
}

export const forgeJoe = defineForge<JoeClient>()({
	id: "forge-joe",
	produces: {
		// Deliberate gap: no accountAge producer. Omission = unsupported.
		[displayName.id]: async (ctx) => {
			const p = await ctx.load("profile", () => ctx.forge.profile());
			return p.name;
		},
		[isFirstContribution.id]: async (ctx) => {
			const p = await ctx.load("profile", () => ctx.forge.profile());
			return p.prCount === 0;
		},
	},
});

// ---------------------------------------------------------------------------
// The client. Generic over its forge; the forge binding narrows the signal
// surface via key remapping: a signal whose id has no producer in the forge's
// map is absent from the type entirely.
// ---------------------------------------------------------------------------

// `never` for Client: producers take ctx contravariantly, so every concrete
// forge is assignable to Forge<never, ...> but not to Forge<unknown, ...>.
export type AnyForge = Forge<never, ProducerMap<never>>;

export type SupportedIds<F> =
	F extends Forge<infer _C, infer P> ? keyof P : never;

export type NarrowedSignals<F> = {
	[Scope in keyof SignalTree]: {
		[K in keyof SignalTree[Scope] as SignalTree[Scope][K] extends {
			id: SupportedIds<F>;
		}
			? K
			: never]: SignalTree[Scope][K];
	};
};

export type Severity = "low" | "medium" | "high";

export interface RuleOutput {
	readonly name: string;
	readonly signal: string;
	readonly comparison: { kind: string; args: readonly unknown[] };
	readonly severity: Severity;
}

function narrowTree(produces: Record<string, unknown>) {
	const out: Record<string, Record<string, AnySignal>> = {};
	const tree = signalTree as Record<string, Record<string, AnySignal>>;
	for (const [scope, group] of Object.entries(tree)) {
		out[scope] = {};
		for (const [key, sig] of Object.entries(group)) {
			if (sig.id in produces) out[scope][key] = sig;
		}
	}
	return out;
}

export class Tripwire<F extends AnyForge> {
	readonly signals: NarrowedSignals<F>;
	readonly apiKey: string | undefined;

	constructor(opts: { forge: F; apiKey?: string }) {
		this.apiKey = opts.apiKey;
		this.signals = narrowTree(opts.forge.produces) as NarrowedSignals<F>;
	}

	// Arrow property so `const { rule } = tripwire` keeps working after
	// destructure. T is inferred from `when` only (NoInfer on comparison) so a
	// mismatch errors on the comparison, in the signal's terms.
	readonly rule = <T>(
		name: string,
		def: {
			when: Signal<string, string, T>;
			comparison: NoInfer<Comparison<T>>;
			severity: Severity;
		},
	): RuleOutput => ({
		name,
		signal: def.when.id,
		comparison: { kind: def.comparison.kind, args: def.comparison.args },
		severity: def.severity,
	});
}
