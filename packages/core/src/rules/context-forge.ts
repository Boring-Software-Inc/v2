import type { RepoScopedEvent } from "@tripwire/contracts";
import {
	accountAge,
	changedPaths,
	commentBody,
	createForgeSignalCtx,
	defineForge,
	filesChanged,
	mergedElsewhere,
	mergedInRepo,
	profileText,
	recentChangeRequestTimes,
	type registry,
	SignalUnavailableError,
	type SignalValue,
	signalUnavailable,
	Tripwire,
	textByLocation,
	title,
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
		signalUnavailable("Tripwire could not read the contributor's profile.");
	}
	return ctx.contributor;
}

function requireDiff(ctx: RuleContext) {
	if (ctx.diff === null) {
		signalUnavailable(
			"Tripwire could not read the files in this change request.",
		);
	}
	return ctx.diff;
}

export const contextForge = defineForge<RuleContext>()({
	id: "rule-context",
	produces: {
		[accountAge.id]: (ctx) => {
			const contributor = requireContributor(ctx.forge);
			const created =
				contributor.createdAt === null
					? NaN
					: Date.parse(contributor.createdAt);
			if (Number.isNaN(created)) {
				signalUnavailable(
					"Tripwire could not read when the contributor's account was created.",
				);
			}
			return Math.floor((Date.parse(ctx.now) - created) / DAY_MS);
		},
		[mergedInRepo.id]: (ctx) => {
			const merged = requireContributor(ctx.forge).mergedInRepo;
			if (merged === null) {
				signalUnavailable(
					"Tripwire could not read the contributor's merge history in this repository.",
				);
			}
			return merged;
		},
		[mergedElsewhere.id]: (ctx) => {
			const merged = requireContributor(ctx.forge).mergedElsewhere;
			if (merged === null) {
				signalUnavailable(
					"Tripwire could not read the contributor's merge history in other repositories.",
				);
			}
			return merged;
		},
		[recentChangeRequestTimes.id]: (ctx) => {
			const times = requireContributor(ctx.forge).recentChangeRequestTimes;
			if (times === null) {
				signalUnavailable(
					"Tripwire could not read the contributor's recent change request history.",
				);
			}
			return times;
		},
		[profileText.id]: (ctx) => requireContributor(ctx.forge).profileText ?? "",
		[title.id]: (ctx) => {
			if ("changeRequest" in ctx.forge.event) {
				return ctx.forge.event.changeRequest.title;
			}
			signalUnavailable("This event has no change request.");
		},
		[commentBody.id]: (ctx) => {
			if (ctx.forge.event.kind === "comment.created") {
				return ctx.forge.event.comment.body;
			}
			signalUnavailable("This event has no comment.");
		},
		[textByLocation.id]: (ctx) => {
			// Insertion order IS the scan order: comment, title, then patch paths.
			// Absent sources are absent keys; an empty map is a valid value.
			const content: Record<string, string> = {};
			const event = ctx.forge.event;
			if (event.kind === "comment.created") {
				content.comment = event.comment.body;
			}
			if ("changeRequest" in event) {
				content.title = event.changeRequest.title;
			}
			for (const file of ctx.forge.diff ?? []) {
				if (file.patch) {
					content[file.path] = file.patch;
				}
			}
			return content;
		},
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
 * Built-in rules author through the SAME client surface an external user
 * gets: the Tripwire client bound to the context forge. One rule shape, no
 * core dialect.
 */
export const contextTripwire = new Tripwire({ forge: contextForge });
export const { rule, signals } = contextTripwire;
