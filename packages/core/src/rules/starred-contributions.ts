import {
	mergedPrRepoStarsConfigSchema,
	ownedRepoStarsConfigSchema,
	type StarredContributionQuery,
} from "@tripwire/contracts";
import { z } from "zod";
import type { RuleContext } from "../context.ts";
import { defineRule } from "./define.ts";

const resultSchema = z.object({
	matchingCount: z.int().min(0),
	complete: z.boolean(),
});

async function evaluate(ctx: RuleContext, query: StarredContributionQuery) {
	if (ctx.event.forge !== "github" || !("changeRequest" in ctx.event)) {
		return {
			status: "skipped" as const,
			reason: "This rule needs a GitHub pull request author.",
		};
	}
	const result = await ctx.countStarredContributions?.(query);
	if (!result || (!result.complete && result.count < query.min)) {
		return {
			status: "skipped" as const,
			reason:
				"GitHub did not return enough public history to evaluate this rule.",
		};
	}
	return {
		status: "evaluated" as const,
		passed: result.count >= query.min,
		evidence: { matchingCount: result.count, complete: result.complete },
	};
}

export const ownedRepoStars = defineRule({
	id: "owned-repo-stars",
	version: 1,
	configSchema: ownedRepoStarsConfigSchema,
	resultSchema,
	evaluate: (ctx, config) =>
		evaluate(ctx, { kind: "owned-repositories", ...config }),
	publicEvidence: ({ matchingCount, complete }) => ({
		matchingCount,
		complete,
	}),
	summarize: (_, passed) =>
		passed
			? "Your public repositories meet this project's star requirement."
			: "You need more qualifying public repositories to meet this project's star requirement.",
	remedy: "wait",
});

export const mergedPrRepoStars = defineRule({
	id: "merged-pr-repo-stars",
	version: 1,
	configSchema: mergedPrRepoStarsConfigSchema,
	resultSchema,
	evaluate: (ctx, config) =>
		evaluate(ctx, { kind: "merged-pull-requests", ...config }),
	publicEvidence: ({ matchingCount, complete }) => ({
		matchingCount,
		complete,
	}),
	summarize: (_, passed) =>
		passed
			? "Your prior merges meet this project's repository star requirement."
			: "You need more qualifying merges to meet this project's repository star requirement.",
	remedy: "wait",
});
