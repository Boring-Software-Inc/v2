import {
	minMergedPrsConfigSchema,
	minMergedPrsConfigSchemaV2,
} from "@tripwire/contracts";
import { z } from "zod";
import { defineRule } from "./define.ts";

/**
 * min-merged-prs@1 — FROZEN. The contributor must have at least `min` merged
 * change requests in the SUBJECT repo. This is unsatisfiable for a first-timer
 * (you can't merge here without first merging here) — @2 fixes it — but @1 stays
 * registered, byte-for-byte, so stored @1 runs remain interpretable (§6).
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
		e.mergedInRepo === 0
			? "you have no merged changes in this repo yet"
			: `you have ${e.mergedInRepo} merged ${e.mergedInRepo === 1 ? "change" : "changes"} in this repo`,
	// Clears by landing merged changes in the repo — activity, not this commit.
	remedy: "wait",
});

/**
 * min-merged-prs@2 — the requirement is now GLOBAL: at least `min` merged change
 * requests in repos the contributor does NOT own or push to. That is the real
 * signal — "someone else reviewed and accepted their work" — and it's
 * satisfiable by any first-timer (contribute anywhere else), unlike @1. Without
 * the ownership exclusion an attacker self-creates a repo, self-merges a PR, and
 * fakes a reputation check in 90 seconds.
 *
 * `mergedInRepo` becomes an EXEMPTION, not a requirement: a proven LOCAL
 * contributor (>= `trustedAfter` merges in THIS repo) passes regardless of their
 * global count — you don't re-gate someone the repo already trusts. The count is
 * kept in evidence either way; it's a free trust signal.
 *
 * Degrades honestly: no contributor read, or no global count, ⇒ SKIP (§6).
 */
export const minMergedPrsV2 = defineRule({
	id: "min-merged-prs",
	version: 2,
	configSchema: minMergedPrsConfigSchemaV2,
	resultSchema: z.object({
		mergedElsewhere: z.number(),
		mergedInRepo: z.number(),
		min: z.number(),
		trustedAfter: z.number(),
	}),
	evaluate(ctx, config) {
		if (ctx.contributor === null) {
			return { status: "skipped", reason: "contributor profile unavailable" };
		}
		const { mergedElsewhere, mergedInRepo } = ctx.contributor;
		if (mergedElsewhere === null) {
			return { status: "skipped", reason: "global merge history unavailable" };
		}
		const trustedLocally = mergedInRepo >= config.trustedAfter;
		return {
			status: "evaluated",
			passed: trustedLocally || mergedElsewhere >= config.min,
			evidence: {
				mergedElsewhere,
				mergedInRepo,
				min: config.min,
				trustedAfter: config.trustedAfter,
			},
		};
	},
	// Observed counts only — the configured thresholds stay gated (§10).
	publicEvidence: (e) => ({
		mergedElsewhere: e.mergedElsewhere,
		mergedInRepo: e.mergedInRepo,
	}),
	summarize: (e) =>
		e.mergedElsewhere === 0
			? "you have no merged changes in other repos yet"
			: `you have ${e.mergedElsewhere} merged ${e.mergedElsewhere === 1 ? "change" : "changes"} in other repos`,
	// Now honestly clearable — contribute (and get merged) elsewhere.
	remedy: "wait",
	// Derived remainder only — how many MORE, never the configured threshold.
	waitHint: (e) => {
		const remaining = e.min - e.mergedElsewhere;
		return remaining > 0
			? `it clears after ${remaining} more accepted ${remaining === 1 ? "merge" : "merges"} elsewhere`
			: null;
	},
});
