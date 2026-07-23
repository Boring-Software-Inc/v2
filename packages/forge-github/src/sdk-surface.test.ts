import { describe, expect, test } from "bun:test";
import { atMost, matches, Tripwire, under } from "@tripwire/sdk";
import { githubForge } from "./signals.ts";

/**
 * The dogfood surface: the GitHub forge bound into the same SDK client an
 * external author would use. GitHub produces every registry signal, so the
 * full surface is present, and the comparison constraints hold through it.
 */

const tripwire = new Tripwire({ forge: githubForge });
const { rule, signals } = tripwire;

describe("github sdk surface", () => {
	test("github produces every registry signal, so the full tree is exposed", () => {
		expect(Object.keys(signals.contributor).sort()).toEqual([
			"accountAge",
			"company",
			"followers",
			"following",
			"hireable",
			"isPublicProfile",
			"location",
			"login",
			"mergeRatioGlobal",
			"mergedElsewhere",
			"profileCompleteness",
			"profileText",
			"prsOpened",
			"publicGists",
			"publicRepos",
			"recentChangeRequestTimes",
			"recentForkTimes",
		]);
		expect(Object.keys(signals.repoRelation).sort()).toEqual([
			"closedUnmergedInRepo",
			"commentedInRepo",
			"isMaintainer",
			"isOrgMember",
			"issuesOpenedInRepo",
			"mergeRatioInRepo",
			"mergedInRepo",
		]);
		expect(Object.keys(signals.pr).sort()).toEqual([
			"addedCommentCount",
			"allCommitsByAuthor",
			"allCommitsVerified",
			"body",
			"changedPaths",
			"codeReferenceCount",
			"commitAuthors",
			"commitCount",
			"commitMessages",
			"conventionalCommits",
			"emojiCount",
			"fileExtensions",
			"filesChanged",
			"isDraft",
			"linesAdded",
			"linesChanged",
			"linesDeleted",
			"linkedIssueCount",
			"maintainerCanModify",
			"maxCommitMessageLength",
			"negativeReactions",
			"patchByPath",
			"referencedIssueNumbers",
			"sourceBranch",
			"targetBranch",
			"textByLocation",
			"title",
			"titleIsConventional",
			"verifiedCommits",
		]);
		expect(Object.keys(signals.comment)).toEqual(["body"]);
	});

	test("example rules authored through the surface are pure data", () => {
		const oldEnough = rule("account age", {
			when: signals.contributor.accountAge,
			comparison: under(7),
			severity: "medium",
		});
		const rateLimit = rule("pr rate limit", {
			when: signals.contributor.recentChangeRequestTimes.last("24h").count,
			comparison: atMost(5),
			severity: "high",
		});
		const latinTitle = rule("latin title", {
			when: signals.pr.title,
			comparison: matches(/^[\p{Script=Latin}\P{L}]*$/u),
			severity: "low",
		});
		expect(oldEnough.signal).toEqual({ id: "contributor.accountAge" });
		expect(rateLimit.signal.transform).toEqual({
			kind: "lastCount",
			window: "24h",
		});
		expect(latinTitle.comparison.kind).toBe("matches");
	});

	test("the comparison constraint holds on the github surface", () => {
		rule("bad", {
			when: signals.pr.filesChanged,
			// @ts-expect-error matches() is for text signals; filesChanged is a number signal
			comparison: matches(/x/),
			severity: "low",
		});
	});
});
