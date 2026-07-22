import type { RepoScopedEvent } from "@tripwire/contracts";
import {
	accountAge,
	type Comparison,
	changedPaths,
	createForgeSignalCtx,
	defineForge,
	filesChanged,
	mergedElsewhere,
	mergedInRepo,
	profileText,
	recentChangeRequestTimes,
	type registry,
	type Severity,
	type SignalRef,
	type SignalRule,
	SignalUnavailableError,
	type SignalValue,
	signalUnavailable,
	type WindowSpec,
} from "@tripwire/sdk";
import type { RuleContext } from "../context.ts";

/**
 * The context forge: built-in rules read signals from the pre-fetched
 * RuleContext (§5.8), so core dogfoods defineForge with RuleContext as the
 * client. Producer return types are enforced against the registry exactly
 * like a network forge's, and unavailability carries the rules' historical
 * skip reasons, byte for byte.
 */

const DAY_MS = 86_400_000;

type Registry = typeof registry;

function requireContributor(ctx: RuleContext) {
	if (ctx.contributor === null) {
		signalUnavailable("contributor profile unavailable");
	}
	return ctx.contributor;
}

function requireDiff(ctx: RuleContext) {
	if (ctx.diff === null) {
		signalUnavailable("diff unavailable");
	}
	return ctx.diff;
}

export const contextForge = defineForge<RuleContext>()({
	id: "rule-context",
	produces: {
		[accountAge.id]: (ctx) => {
			const contributor = requireContributor(ctx.forge);
			const created = Date.parse(contributor.createdAt);
			if (Number.isNaN(created)) {
				signalUnavailable("contributor createdAt unparseable");
			}
			return Math.floor((Date.parse(ctx.now) - created) / DAY_MS);
		},
		[mergedInRepo.id]: (ctx) => requireContributor(ctx.forge).mergedInRepo,
		[mergedElsewhere.id]: (ctx) => {
			const merged = requireContributor(ctx.forge).mergedElsewhere;
			if (merged === null) {
				signalUnavailable("global merge history unavailable");
			}
			return merged;
		},
		[recentChangeRequestTimes.id]: (ctx) =>
			requireContributor(ctx.forge).recentChangeRequestTimes,
		[profileText.id]: (ctx) => requireContributor(ctx.forge).profileText ?? "",
		[filesChanged.id]: (ctx) => requireDiff(ctx.forge).length,
		[changedPaths.id]: (ctx) => requireDiff(ctx.forge).map((file) => file.path),
	},
});

export type ContextSignalId = keyof typeof contextForge.produces;

export type SignalRead<T> =
	| { ok: true; value: T }
	| { ok: false; reason: string };

/**
 * Reads one signal's value out of the RuleContext through the context
 * forge's producer. A SignalUnavailableError becomes the rule's skip
 * reason; anything else is a bug and propagates.
 */
export async function readContextSignal<Id extends ContextSignalId>(
	id: Id,
	ctx: RuleContext,
): Promise<SignalRead<SignalValue<Registry[Id]>>> {
	const producer = contextForge.produces[id];
	// Rules only run on repo-scoped events; installation events never reach
	// evaluate(). The producers here read ctx.forge, not the event.
	const signalCtx = createForgeSignalCtx({
		forge: ctx,
		event: ctx.event as RepoScopedEvent,
		now: ctx.now,
	});
	try {
		const value = await producer(signalCtx);
		// The ProducerMap constraint already ties this producer's return type to
		// the signal's declared type; the assertion restates it for the generic Id.
		return { ok: true, value: value as SignalValue<Registry[Id]> };
	} catch (error) {
		if (error instanceof SignalUnavailableError) {
			return { ok: false, reason: error.reason };
		}
		throw error;
	}
}

/**
 * Core-internal typed refs for authoring built-in rules over the registry.
 * External authors go through the forge-bound client surface; core is the
 * engine underneath it, and these constructors keep the same type-flow:
 * the ref's value type constrains the comparison.
 */
export interface TypedSignalRef<T> {
	readonly ref: SignalRef;
	/** Phantom only. Never set at runtime; it carries T invariantly. */
	readonly "~signalValueType"?: (value: T) => T;
}

export function signalOf<Id extends ContextSignalId>(
	id: Id,
): TypedSignalRef<SignalValue<Registry[Id]>> {
	return { ref: { id } };
}

type TimestampsSignalId = {
	[Id in ContextSignalId]: Registry[Id]["type"] extends { kind: "timestamps" }
		? Id
		: never;
}[ContextSignalId];

type TextSignalId = {
	[Id in ContextSignalId]: Registry[Id]["type"] extends { kind: "text" }
		? Id
		: never;
}[ContextSignalId];

export function lastCountOf(
	id: TimestampsSignalId,
	window: WindowSpec,
): TypedSignalRef<number> {
	return { ref: { id, transform: { kind: "lastCount", window } } };
}

export function trimmedLengthOf(id: TextSignalId): TypedSignalRef<number> {
	return { ref: { id, transform: { kind: "trimmedLength" } } };
}

/**
 * Authors one SDK signal rule from a typed ref: same named fields, same
 * comparison constraint, same pure data out as the client's rule().
 */
export function builtinRule<T>(
	name: string,
	def: {
		when: TypedSignalRef<T>;
		comparison: NoInfer<Comparison<T>>;
		severity: Severity;
	},
): SignalRule {
	return {
		name,
		signal: def.when.ref,
		comparison: { kind: def.comparison.kind, args: def.comparison.args },
		severity: def.severity,
	};
}
