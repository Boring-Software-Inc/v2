import { z } from "zod";
import { threadKindSchema } from "./insights.ts";
import { itemTypeSchema, modStatSchema } from "./moderation.ts";
import { aiReviewConfigSchema } from "./review.ts";

/**
 * Rules domain (spec §4 `rules.ts`, §6). Extracted from the demo's
 * `automod.types.ts` — `Rule` was the demo's `AutomodRule`, `RuleMatch` its
 * `AutomodMatch`. The §6 `RuleResult` envelope lands with the rules-registry
 * build step.
 */

export const ruleCategorySchema = z.enum([
	"blocklist",
	"heuristic",
	"classifier",
	"regex",
]);
export type RuleCategory = z.infer<typeof ruleCategorySchema>;

export const ruleActionSchema = z.enum([
	"flag",
	"hide",
	"close",
	"require-review",
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const matchVerdictSchema = z.enum([
	"pending",
	"confirmed",
	"false-positive",
]);
export type MatchVerdict = z.infer<typeof matchVerdictSchema>;

/** One firing of a rule on content (was demo `AutomodMatch`). */
export const ruleMatchSchema = z.object({
	id: z.string(),
	type: itemTypeSchema,
	repoFullName: z.string(),
	number: z.number(),
	author: z.object({ login: z.string(), avatarUrl: z.string() }),
	snippet: z.string(),
	matchedAt: z.iso.datetime(),
	verdict: matchVerdictSchema,
	/** Routes the match back to its conversation. */
	threadKind: threadKindSchema,
	/** The comment to highlight in that thread (matches a thread comment id). */
	commentId: z.string(),
});
export type RuleMatch = z.infer<typeof ruleMatchSchema>;

/** A configured rule as the Rules surface shows it (was demo `AutomodRule`). */
export const ruleSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	category: ruleCategorySchema,
	/** The literal blocklist entry / regex / classifier label that fires. */
	pattern: z.string(),
	scope: z.array(itemTypeSchema),
	action: ruleActionSchema,
	enabled: z.boolean(),
	matches24h: z.number(),
	matches30d: z.number(),
	/** Percentage, 0–100. */
	falsePositiveRate: z.number().min(0).max(100),
	lastFiredAt: z.iso.datetime(),
	/** Match volume over the last 7 days, oldest → newest. Drives the sparkline. */
	trend: z.array(z.number()),
	recentMatches: z.array(ruleMatchSchema),
});
export type Rule = z.infer<typeof ruleSchema>;

export const ruleStatsSchema = z.object({
	activeRules: modStatSchema,
	matches24h: modStatSchema,
	falsePositiveRate: modStatSchema,
	autoActioned24h: modStatSchema,
});
export type RuleStats = z.infer<typeof ruleStatsSchema>;

/**
 * AUTHORED from spec §4/§6 — the RuleResult envelope. Results serialize as
 * validated JSON on the server; types in code, JSON on the wire. A rule that
 * can't evaluate is `skipped` with a reason — never a throw (§6 purity law).
 */
export const ruleResultSchema = z.object({
	/** Rule id WITHOUT version, e.g. "account-age". */
	ruleId: z.string(),
	version: z.number().int().min(1),
	status: z.enum(["evaluated", "skipped"]),
	/** The boolean requirement outcome; false whenever skipped. */
	passed: z.boolean(),
	/** Rule-specific typed payload — what makes appeals real (§6). */
	evidence: z.unknown(),
	/** Present iff skipped. */
	reason: z.string().optional(),
	evaluatedAt: z.iso.datetime(),
});
export type RuleResult = z.infer<typeof ruleResultSchema>;

/**
 * AUTHORED — per-rule config schemas. They live here (not in core) because
 * rule config crosses boundaries: Rules UI form → rule_configs jsonb →
 * worker. Core imports these for its defineRule definitions; evidence
 * schemas stay with the rules.
 */
export const accountAgeConfigSchema = z.object({
	minDays: z.number().int().min(0),
});
export const minMergedPrsConfigSchema = z.object({
	min: z.number().int().min(0),
});
export const prRateLimitConfigSchema = z.object({
	maxPerWindow: z.number().int().min(1),
	windowHours: z.number().min(0.1).default(24),
});
export const maxFilesChangedConfigSchema = z.object({
	max: z.number().int().min(1),
});
export const englishOnlyConfigSchema = z.object({
	maxNonLatinRatio: z.number().min(0).max(1).default(0.5),
});
export const cryptoAddressConfigSchema = z.object({});
export const honeypotConfigSchema = z.object({
	paths: z.array(z.string()).min(1),
});
export const profileReadmeConfigSchema = z.object({
	minLength: z.number().int().min(1).default(32),
});

/**
 * UI-facing catalog of launch rules. The registry (core) is engine truth.
 * `optIn` rules are NON-baseline (§8): off until a maintainer turns them on,
 * and absent from the derived default. The /rules card renders them as an
 * offer, not a silently-off toggle.
 */
export const RULE_CATALOG = [
	{
		ruleId: "account-age",
		version: 1,
		name: "account age",
		blurb: "the contributor's forge account must be at least N days old.",
		configSchema: accountAgeConfigSchema,
		defaultConfig: { minDays: 7 },
		optIn: false,
	},
	{
		ruleId: "min-merged-prs",
		version: 1,
		name: "merged change requests",
		blurb: "requires N merged change requests in this repo.",
		configSchema: minMergedPrsConfigSchema,
		defaultConfig: { min: 0 },
		optIn: false,
	},
	{
		ruleId: "pr-rate-limit",
		version: 1,
		name: "rate limit",
		blurb:
			"caps change requests per window; spray patterns surface in evidence.",
		configSchema: prRateLimitConfigSchema,
		defaultConfig: { maxPerWindow: 5, windowHours: 24 },
		optIn: false,
	},
	{
		ruleId: "max-files-changed",
		version: 1,
		name: "max files changed",
		blurb: "caps the number of files a change request may touch.",
		configSchema: maxFilesChangedConfigSchema,
		defaultConfig: { max: 200 },
		optIn: false,
	},
	{
		ruleId: "english-only",
		version: 1,
		name: "english only",
		blurb: "title/comment must be predominantly latin-script.",
		configSchema: englishOnlyConfigSchema,
		defaultConfig: { maxNonLatinRatio: 0.5 },
		optIn: false,
	},
	{
		ruleId: "crypto-address",
		version: 1,
		name: "crypto address",
		blurb: "blocks cryptocurrency addresses in titles, comments, and diffs.",
		configSchema: cryptoAddressConfigSchema,
		defaultConfig: {},
		optIn: false,
	},
	{
		ruleId: "honeypot",
		version: 1,
		name: "honeypot paths",
		blurb: "no legitimate change request touches these paths.",
		configSchema: honeypotConfigSchema,
		defaultConfig: { paths: [".github/workflows/**"] },
		optIn: false,
	},
	{
		ruleId: "profile-readme",
		version: 1,
		name: "profile readme",
		blurb: "requires a minimum of profile text — identity investment.",
		configSchema: profileReadmeConfigSchema,
		defaultConfig: { minLength: 32 },
		optIn: false,
	},
	{
		ruleId: "ai-review",
		// @2 — findings quote code in backticks. @1 stays registered for stored
		// runs, but a repo enabling ai-review now pins the current version.
		version: 2,
		name: "ai review",
		blurb: "off until you turn it on — ai review costs tokens.",
		configSchema: aiReviewConfigSchema,
		defaultConfig: { maxSteps: 12 },
		optIn: true,
	},
] as const;
