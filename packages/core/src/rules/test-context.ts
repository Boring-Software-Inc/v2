import {
	type NormalizedEvent,
	normalizedEventSchema,
} from "@tripwire/contracts";
import type {
	ContextContributor,
	ContextDiffFile,
	RuleContext,
} from "../context.ts";

/**
 * Fixture contexts for rule unit tests (§11): the event is a captured payload
 * run through the real normalizer and stored under `packages/core/fixtures/`
 * (core cannot import the adapter — the arrows forbid it). Diff/contributor
 * parts are per-test inputs layered over sane defaults.
 */

export const FIXTURE_NOW = "2026-07-11T00:00:00.000Z";

export async function fixtureEvent(
	name: "change-request.opened.event" | "comment.created.event",
): Promise<NormalizedEvent> {
	const path = new URL(`../../fixtures/${name}.json`, import.meta.url).pathname;
	return normalizedEventSchema.parse(await Bun.file(path).json());
}

export function fixtureContributor(
	overrides: Partial<ContextContributor> = {},
): ContextContributor {
	return {
		login: "octocat",
		createdAt: "2020-01-01T00:00:00.000Z",
		followers: 12,
		publicRepos: 8,
		profileText: "I build things. Mostly things that build other things.",
		mergedInRepo: 3,
		mergedElsewhere: 4,
		recentChangeRequestTimes: [],
		isOrgMember: false,
		isMaintainer: false,
		...overrides,
	};
}

export function fixtureDiff(
	files: Partial<ContextDiffFile>[] = [{}],
): ContextDiffFile[] {
	return files.map((file, i) => ({
		path: `src/file-${i}.ts`,
		status: "modified",
		additions: 3,
		deletions: 1,
		...file,
	}));
}

export async function fixtureContext(
	overrides: Partial<RuleContext> = {},
): Promise<RuleContext> {
	return {
		event: await fixtureEvent("change-request.opened.event"),
		now: FIXTURE_NOW,
		diff: fixtureDiff(),
		commits: [],
		contributor: fixtureContributor(),
		...overrides,
	};
}
