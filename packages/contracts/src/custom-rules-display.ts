import type { CustomRuleDefinition } from "./custom-rules.ts";

/**
 * Plain-language display for custom rules: the signal labels the picker
 * shows, the verb phrases the sentence uses, and the two sentences built
 * from a definition. Internal signal ids never reach users.
 *
 * Two sentences, two audiences (§10):
 * - customRuleSentence: the MAINTAINER read state ("flag when account age
 *   is under 7 days, as a medium signal"). Carries the threshold; renders
 *   on the rule card and the builder.
 * - customRuleSummary: the PUBLIC one-liner built from the OBSERVED value
 *   only ("account age is 3 days"). The configured threshold never appears,
 *   same as built-in summaries.
 */

export interface CustomSignalDisplay {
	/** The registry signal id. Stable identity; never shown. */
	id: string;
	label: string;
	group:
		| "The account"
		| "Their activity"
		| "This repo"
		| "This change"
		| "The PR description"
		| "The commits"
		| "The comment";
	kind: "number" | "text" | "boolean" | "textList" | "timestamps";
	/** Unit for observed values, e.g. "days". */
	unit?: string;
	/** Timestamps signals author as a windowed count over this history cap. */
	maxWindowHours?: number;
}

export const CUSTOM_SIGNALS: readonly CustomSignalDisplay[] = [
	{
		id: "contributor.accountAge",
		label: "Account age",
		group: "The account",
		kind: "number",
		unit: "days",
	},
	{
		id: "contributor.followers",
		label: "Followers",
		group: "The account",
		kind: "number",
	},
	{
		id: "contributor.following",
		label: "Following",
		group: "The account",
		kind: "number",
	},
	{
		id: "contributor.publicRepos",
		label: "Public repos",
		group: "The account",
		kind: "number",
	},
	{
		id: "contributor.publicGists",
		label: "Public gists",
		group: "The account",
		kind: "number",
	},
	{
		id: "contributor.profileText",
		label: "Profile bio",
		group: "The account",
		kind: "text",
	},
	{
		id: "contributor.company",
		label: "Company",
		group: "The account",
		kind: "text",
	},
	{
		id: "contributor.location",
		label: "Location",
		group: "The account",
		kind: "text",
	},
	{
		id: "contributor.hireable",
		label: "Open to hire",
		group: "The account",
		kind: "boolean",
	},
	{
		id: "contributor.login",
		label: "Username",
		group: "The account",
		kind: "text",
	},
	{
		id: "contributor.profileCompleteness",
		label: "Profile completeness",
		group: "The account",
		kind: "number",
	},
	{
		id: "contributor.isPublicProfile",
		label: "Public profile",
		group: "The account",
		kind: "boolean",
	},
	{
		id: "contributor.prsOpened",
		label: "PRs opened",
		group: "Their activity",
		kind: "number",
	},
	{
		id: "contributor.mergedElsewhere",
		label: "PRs merged elsewhere",
		group: "Their activity",
		kind: "number",
	},
	{
		id: "contributor.recentForkTimes",
		label: "Fork rate",
		group: "Their activity",
		kind: "timestamps",
		maxWindowHours: 7 * 24,
	},
	{
		id: "contributor.recentChangeRequestTimes",
		label: "PR rate",
		group: "Their activity",
		kind: "timestamps",
		maxWindowHours: 30 * 24,
	},
	{
		id: "contributor.mergeRatioGlobal",
		label: "Merge rate anywhere",
		group: "Their activity",
		kind: "number",
		unit: "%",
	},
	{
		id: "repoRelation.mergedInRepo",
		label: "PRs merged here",
		group: "This repo",
		kind: "number",
	},
	{
		id: "repoRelation.mergeRatioInRepo",
		label: "Merge rate here",
		group: "This repo",
		kind: "number",
		unit: "%",
	},
	{
		id: "repoRelation.issuesOpenedInRepo",
		label: "Issues opened here",
		group: "This repo",
		kind: "number",
	},
	{
		id: "repoRelation.commentedInRepo",
		label: "Commented here",
		group: "This repo",
		kind: "number",
	},
	{
		id: "repoRelation.closedUnmergedInRepo",
		label: "PRs closed unmerged here",
		group: "This repo",
		kind: "number",
	},
	{
		id: "repoRelation.isOrgMember",
		label: "Org member",
		group: "This repo",
		kind: "boolean",
	},
	{
		id: "repoRelation.isMaintainer",
		label: "Has write access",
		group: "This repo",
		kind: "boolean",
	},
	{
		id: "pr.filesChanged",
		label: "Files changed",
		group: "This change",
		kind: "number",
	},
	{
		id: "pr.changedPaths",
		label: "Changed paths",
		group: "This change",
		kind: "textList",
	},
	{
		id: "pr.linesAdded",
		label: "Lines added",
		group: "This change",
		kind: "number",
	},
	{
		id: "pr.linesDeleted",
		label: "Lines deleted",
		group: "This change",
		kind: "number",
	},
	{
		id: "pr.linesChanged",
		label: "Lines changed",
		group: "This change",
		kind: "number",
	},
	{
		id: "pr.fileExtensions",
		label: "File extensions",
		group: "This change",
		kind: "textList",
	},
	{
		id: "pr.targetBranch",
		label: "Target branch",
		group: "This change",
		kind: "text",
	},
	{
		id: "pr.sourceBranch",
		label: "Source branch",
		group: "This change",
		kind: "text",
	},
	{ id: "pr.isDraft", label: "Draft", group: "This change", kind: "boolean" },
	{
		id: "pr.maintainerCanModify",
		label: "Maintainers can edit",
		group: "This change",
		kind: "boolean",
	},
	{
		id: "pr.addedCommentCount",
		label: "Added comments",
		group: "This change",
		kind: "number",
	},
	{
		id: "pr.negativeReactions",
		label: "Negative reactions",
		group: "This change",
		kind: "number",
	},
	{
		id: "pr.title",
		label: "PR title",
		group: "The PR description",
		kind: "text",
	},
	{
		id: "pr.titleIsConventional",
		label: "Conventional title",
		group: "The PR description",
		kind: "boolean",
	},
	{
		id: "pr.body",
		label: "PR description",
		group: "The PR description",
		kind: "text",
	},
	{
		id: "pr.emojiCount",
		label: "Emoji count",
		group: "The PR description",
		kind: "number",
	},
	{
		id: "pr.codeReferenceCount",
		label: "Code references",
		group: "The PR description",
		kind: "number",
	},
	{
		id: "pr.linkedIssueCount",
		label: "Linked issues",
		group: "The PR description",
		kind: "number",
	},
	{
		id: "pr.referencedIssueNumbers",
		label: "Referenced issue numbers",
		group: "The PR description",
		kind: "textList",
	},
	{
		id: "pr.commitCount",
		label: "Commit count",
		group: "The commits",
		kind: "number",
	},
	{
		id: "pr.verifiedCommits",
		label: "Verified commits",
		group: "The commits",
		kind: "number",
	},
	{
		id: "pr.allCommitsVerified",
		label: "All commits verified",
		group: "The commits",
		kind: "boolean",
	},
	{
		id: "pr.commitMessages",
		label: "Commit messages",
		group: "The commits",
		kind: "textList",
	},
	{
		id: "pr.commitAuthors",
		label: "Commit authors",
		group: "The commits",
		kind: "textList",
	},
	{
		id: "pr.allCommitsByAuthor",
		label: "All commits by author",
		group: "The commits",
		kind: "boolean",
	},
	{
		id: "pr.conventionalCommits",
		label: "Conventional commits",
		group: "The commits",
		kind: "boolean",
	},
	{
		id: "pr.maxCommitMessageLength",
		label: "Longest commit message",
		group: "The commits",
		kind: "number",
		unit: "chars",
	},
	{
		id: "comment.body",
		label: "Comment text",
		group: "The comment",
		kind: "text",
	},
];

export function customSignalDisplay(id: string): CustomSignalDisplay | null {
	return CUSTOM_SIGNALS.find((signal) => signal.id === id) ?? null;
}

/** The verbs each signal kind offers. The picker shows nothing else, so a
 * numeric signal cannot pair with a text verb by construction. */
export const VERBS_BY_KIND: Record<
	CustomSignalDisplay["kind"],
	readonly { kind: string; label: string }[]
> = {
	number: [
		{ kind: "under", label: "is under" },
		{ kind: "over", label: "is over" },
		{ kind: "atLeast", label: "is at least" },
		{ kind: "atMost", label: "is at most" },
		{ kind: "equals", label: "is exactly" },
		{ kind: "between", label: "is between" },
	],
	text: [
		{ kind: "has", label: "contains" },
		{ kind: "containsAny", label: "contains any of" },
		{ kind: "equals", label: "is exactly" },
		{ kind: "oneOf", label: "is one of" },
		{ kind: "noneOf", label: "is none of" },
	],
	boolean: [
		{ kind: "equals", label: "is present" },
		{ kind: "not", label: "is missing" },
	],
	textList: [
		{ kind: "noneMatch", label: "touches none of" },
		{ kind: "anyIn", label: "is any of" },
	],
	// Timestamps author as .last(window).count, then compare as numbers.
	timestamps: [
		{ kind: "atMost", label: "is at most" },
		{ kind: "under", label: "is under" },
		{ kind: "over", label: "is over" },
		{ kind: "atLeast", label: "is at least" },
	],
};

function verbPhrase(
	kind: string,
	signalKind: CustomSignalDisplay["kind"],
): string {
	const verb = VERBS_BY_KIND[signalKind].find((v) => v.kind === kind);
	return verb?.label ?? kind;
}

function formatValue(value: unknown, unit?: string): string {
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry)).join(", ");
	}
	if (typeof value === "number" && unit) {
		return `${value} ${unit}`;
	}
	return String(value);
}

function windowPhrase(definition: CustomRuleDefinition): string {
	const transform = definition.when.transform;
	if (
		!transform ||
		(transform.kind !== "last" && transform.kind !== "lastCount")
	) {
		return "";
	}
	const window = transform.window;
	const count = Number.parseInt(window, 10);
	const unit = window.endsWith("h")
		? count === 1
			? "hour"
			: "hours"
		: count === 1
			? "day"
			: "days";
	return ` in the last ${count} ${unit}`;
}

/**
 * The maintainer read state, one sentence: what the builder edits and the
 * rule card shows. Carries the configured value; maintainer surface only.
 */
export function customRuleSentence(definition: CustomRuleDefinition): string {
	const signal = customSignalDisplay(definition.when.id);
	const label = signal?.label ?? definition.when.id;
	const signalKind = signal?.kind ?? "number";
	const { comparison } = definition;
	let clause: string;
	if (signalKind === "boolean") {
		clause =
			comparison.kind === "not" || comparison.args[0] === false
				? "is missing"
				: "is present";
	} else if (comparison.kind === "between") {
		clause = `is between ${formatValue(comparison.args[0])} and ${formatValue(comparison.args[1], signal?.unit)}`;
	} else {
		clause = `${verbPhrase(comparison.kind, signalKind)} ${formatValue(comparison.args[0], signal?.unit)}`;
	}
	return `flag when ${label.toLowerCase()}${windowPhrase(definition)} ${clause}, as a ${definition.severity} signal`;
}

/**
 * The public one-liner, built from the OBSERVED value only. The configured
 * threshold never appears here (§10): show what was seen, not the bar.
 */
export function customRuleSummary(
	definition: CustomRuleDefinition,
	observed: unknown,
): string | null {
	const signal = customSignalDisplay(definition.when.id);
	if (!signal) {
		return null;
	}
	const label = signal.label.toLowerCase();
	if (signal.kind === "boolean") {
		return `${label}: ${observed === true ? "yes" : "no"}`;
	}
	if (signal.kind === "textList") {
		return Array.isArray(observed)
			? `this change touches ${observed.length} ${observed.length === 1 ? "path" : "paths"}`
			: null;
	}
	return `${label}${windowPhrase(definition)} is ${formatValue(observed, signal.unit)}`;
}
