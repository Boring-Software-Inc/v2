import { minMergedPrsConfigSchema } from "@tripwire/contracts";
import { z } from "zod";
import { defineRule } from "./define.ts";

/**
 * min-merged-prs@1 — the contributor must have at least `min` merged change
 * requests in the subject repo. Evidence: actual count vs the requirement.
 */
export const minMergedPrs = defineRule({
	id: "min-merged-prs",
	version: 1,
	configSchema: minMergedPrsConfigSchema,
	resultSchema: z.object({
		mergedInRepo: z.number(),
		min: z.number(),
	}),
	evaluate(ctx, config) {
		if (ctx.contributor === null) {
			return { status: "skipped", reason: "contributor profile unavailable" };
		}
		return {
			status: "evaluated",
			passed: ctx.contributor.mergedInRepo >= config.min,
			evidence: { mergedInRepo: ctx.contributor.mergedInRepo, min: config.min },
		};
	},
	publicEvidence: (e) => ({ mergedInRepo: e.mergedInRepo }),
	summarize: (e) =>
		`${e.mergedInRepo} merged change ${e.mergedInRepo === 1 ? "request" : "requests"} in this repo`,
	// Clears by landing merged changes in the repo — activity, not this commit.
	remedy: "wait",
});
