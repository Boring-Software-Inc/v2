import { describe, expect, test } from "bun:test";
import {
	gitCafeReadBlobSchema,
	gitCafeReadChangesSchema,
	gitCafeReadCollaboratorsSchema,
	gitCafeReadCommitsSchema,
	gitCafeReadDiffFileSchema,
	gitCafeReadIssueThreadPageSchema,
	gitCafeReadProfileSchema,
	gitCafeReadPullPageSchema,
	gitCafeReadPullSchema,
	gitCafeReadPullThreadPageSchema,
	gitCafeReadRefPageSchema,
} from "@tripwire/contracts";
import publicProfile from "../fixtures/gitcafe-profile.json";
import pull from "../fixtures/gitcafe-pull.json";
import collaborators from "../fixtures/gitcafe-read-collaborators.json";
import issueThreads from "../fixtures/gitcafe-read-issues-list.json";
import emptyIssues from "../fixtures/gitcafe-read-issues-list-empty.json";
import profile from "../fixtures/gitcafe-read-profile.json";
import pulls from "../fixtures/gitcafe-read-pulls.json";
import pullThreads from "../fixtures/gitcafe-read-pulls-list.json";
import refs from "../fixtures/gitcafe-read-refs.json";
import scratchBlob from "../fixtures/gitcafe-read-scratch-blob-0.json";
import scratchChanges from "../fixtures/gitcafe-read-scratch-changes.json";
import scratchCommits from "../fixtures/gitcafe-read-scratch-commits.json";
import scratchDiff from "../fixtures/gitcafe-read-scratch-diff-0.json";
import scratchPull from "../fixtures/gitcafe-read-scratch-pull.json";
import blob from "../fixtures/gitcafe-source.json";

describe("captured GitCafe read boundaries", () => {
	test("parses installed branch and thread pages without inventing missing detail", () => {
		expect(
			gitCafeReadRefPageSchema.parse(refs).items.map((item) => item.name),
		).toEqual(["main", "tripwire-qa/adapter-20261028"]);
		expect(
			gitCafeReadPullThreadPageSchema.parse(pullThreads).items[0]?.number,
		).toBe(1);
		expect(
			gitCafeReadIssueThreadPageSchema.parse(issueThreads).items[0]?.number,
		).toBe(2);
		expect(gitCafeReadIssueThreadPageSchema.parse(emptyIssues)).toEqual({
			items: [],
			next: null,
		});
	});
	test("preserves the immutable public pull and exact source capture", () => {
		expect(gitCafeReadPullSchema.safeParse(pull).success).toBe(true);
		expect(gitCafeReadBlobSchema.safeParse(blob).success).toBe(true);
		expect(gitCafeReadProfileSchema.safeParse(publicProfile).success).toBe(
			true,
		);
	});
	test("parses authorized scratch reads without claiming nonempty coverage", () => {
		expect(gitCafeReadProfileSchema.parse(profile).bio).toBe(
			"founder, tripwire",
		);
		expect(gitCafeReadPullPageSchema.parse(pulls)).toEqual({
			items: [],
			next: null,
		});
		expect(gitCafeReadCollaboratorsSchema.parse(collaborators)).toEqual({
			items: [],
			next: null,
		});
	});
});

test("genuine scratch PR captures cover nonempty changes, hunks, commits and exact source", () => {
	const pr = gitCafeReadPullSchema.parse(scratchPull);
	if (pr.headOid === null)
		throw new Error("Captured scratch pull has no head OID");
	expect(pr.additions).toBeNull();
	expect(pr.deletions).toBeNull();
	expect(pr.changedFiles).toBeNull();
	expect(gitCafeReadChangesSchema.parse(scratchChanges).items).toHaveLength(1);
	expect(gitCafeReadDiffFileSchema.parse(scratchDiff).file.hunks).toHaveLength(
		1,
	);
	expect(gitCafeReadCommitsSchema.parse(scratchCommits).items).toHaveLength(1);
	expect(gitCafeReadBlobSchema.parse(scratchBlob).commit).toBe(pr.headOid);
});
