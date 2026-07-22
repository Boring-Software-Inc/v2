import { type AnySignal, defineSignal, t } from "./signal.ts";

/**
 * The neutral signal registry: every fact the current signal-based rules
 * read, declared once with a runtime type, a scope, and a description.
 * Forges support a signal by writing a producer for it; omission means
 * unsupported and the signal disappears from that forge's typed surface.
 */

// --- contributor: the account itself, independent of this repo -------------

export const accountAge = defineSignal({
	id: "contributor.accountAge",
	scope: "contributor",
	type: t.number,
	describe: "Days since the contributor's account was created",
});

export const followers = defineSignal({
	id: "contributor.followers",
	scope: "contributor",
	type: t.number,
	describe: "How many accounts follow the contributor",
});

export const following = defineSignal({
	id: "contributor.following",
	scope: "contributor",
	type: t.number,
	describe: "How many accounts the contributor follows",
});

export const publicRepos = defineSignal({
	id: "contributor.publicRepos",
	scope: "contributor",
	type: t.number,
	describe: "How many public repositories the contributor owns",
});

export const profileText = defineSignal({
	id: "contributor.profileText",
	scope: "contributor",
	type: t.text,
	describe: "Profile readme or bio text, empty when the profile has none",
});

export const mergedElsewhere = defineSignal({
	id: "contributor.mergedElsewhere",
	scope: "contributor",
	type: t.number,
	describe:
		"Merged change requests in repos the contributor does not own. Proof that someone else accepted their work",
});

// SHAPE-CHECK: the signal stays WIDE (30 days) so a rule's .last() transform
// reads from enough history. Rules narrow; the signal never truncates.
export const recentChangeRequestTimes = defineSignal({
	id: "contributor.recentChangeRequestTimes",
	scope: "contributor",
	type: t.timestamps,
	history: "30d",
	describe:
		"Timestamps of the contributor's change requests from the last thirty days, newest first",
});

// --- repoRelation: the contributor's standing in the subject repo ----------

export const mergedInRepo = defineSignal({
	id: "repoRelation.mergedInRepo",
	scope: "repoRelation",
	type: t.number,
	describe: "Merged change requests by the contributor in this repo",
});

export const isOrgMember = defineSignal({
	id: "repoRelation.isOrgMember",
	scope: "repoRelation",
	type: t.boolean,
	describe: "True when the contributor is a member of the repo's org",
});

export const isMaintainer = defineSignal({
	id: "repoRelation.isMaintainer",
	scope: "repoRelation",
	type: t.boolean,
	describe: "True when the contributor has write access to the repo",
});

// --- pr: the change request under evaluation --------------------------------

export const title = defineSignal({
	id: "pr.title",
	scope: "pr",
	type: t.text,
	describe: "The change request's title",
});

export const filesChanged = defineSignal({
	id: "pr.filesChanged",
	scope: "pr",
	type: t.number,
	describe: "How many files the change request touches",
});

export const changedPaths = defineSignal({
	id: "pr.changedPaths",
	scope: "pr",
	type: t.textList,
	describe: "The paths the change request touches",
});

// SHAPE-CHECK: forge-neutral when a second forge is added.
export const patchByPath = defineSignal({
	id: "pr.patchByPath",
	scope: "pr",
	type: t.textMap,
	describe: "Unified diff text keyed by the file path it belongs to",
});

// --- comment: the comment that triggered the evaluation ---------------------

export const commentBody = defineSignal({
	id: "comment.body",
	scope: "comment",
	type: t.text,
	describe: "The comment's body text",
});

/** Every signal, keyed by id. This is what the producer map is typed against. */
export const registry = {
	[accountAge.id]: accountAge,
	[followers.id]: followers,
	[following.id]: following,
	[publicRepos.id]: publicRepos,
	[profileText.id]: profileText,
	[mergedElsewhere.id]: mergedElsewhere,
	[recentChangeRequestTimes.id]: recentChangeRequestTimes,
	[mergedInRepo.id]: mergedInRepo,
	[isOrgMember.id]: isOrgMember,
	[isMaintainer.id]: isMaintainer,
	[title.id]: title,
	[filesChanged.id]: filesChanged,
	[changedPaths.id]: changedPaths,
	[patchByPath.id]: patchByPath,
	[commentBody.id]: commentBody,
} as const satisfies Record<string, AnySignal>;

export type SignalRegistry = typeof registry;
export type SignalId = keyof SignalRegistry;

/**
 * The nested authoring surface, signals.<scope>.<name>. Phase 2's client
 * narrows this tree to the bound forge's producers.
 */
export const signalTree = {
	contributor: {
		accountAge,
		followers,
		following,
		publicRepos,
		profileText,
		mergedElsewhere,
		recentChangeRequestTimes,
	},
	repoRelation: { mergedInRepo, isOrgMember, isMaintainer },
	pr: { title, filesChanged, changedPaths, patchByPath },
	comment: { body: commentBody },
};

export type SignalTree = typeof signalTree;
