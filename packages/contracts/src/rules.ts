import { z } from "zod";
import { threadKindSchema } from "./insights.ts";
import { itemTypeSchema, modStatSchema } from "./moderation.ts";
import { aiReviewConfigSchema } from "./review.ts";
import type { JsonValue, WorkflowDefinition } from "./workflow.ts";

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
/** @1 — FROZEN. Stored `min-merged-prs@1` runs validate against this forever. */
export const minMergedPrsConfigSchema = z.object({
	min: z.number().int().min(0),
});
/**
 * @2 config. `.describe()` on every field is the rule-owned label/help the
 * generated /rules form reads (never the raw key). The meaning changed: `min`
 * now counts merges in OTHER people's repos.
 */
export const minMergedPrsConfigSchemaV2 = z.object({
	min: z
		.number()
		.int()
		.min(0)
		.default(1)
		.describe("minimum merged change requests in other people's repos"),
	trustedAfter: z
		.number()
		.int()
		.min(1)
		.default(1)
		.describe("merges in this repo that exempt a proven local contributor"),
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
		/** Toolbox one-liner (§editor rebuild, approved copy). */
		description:
			"Flags change requests from accounts younger than a threshold you set.",
	},
	{
		ruleId: "min-merged-prs",
		version: 2,
		name: "merged change requests",
		blurb:
			"requires N merged change requests in OTHER people's repos — proof someone else accepted their work.",
		configSchema: minMergedPrsConfigSchemaV2,
		defaultConfig: { min: 1, trustedAfter: 1 },
		optIn: false,
		/** §6 (b) — what @2 changed vs the pinned prior version; the Rules-page
		 * "update available" note. Only bumped rules carry one. */
		changeNote: "counts merges globally, not per-repo",
		/** Toolbox one-liner (§editor rebuild, approved copy). */
		description:
			"Requires N merged change requests in other people's repos — proof someone else accepted their work.",
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
		/** Toolbox one-liner (§editor rebuild, approved copy). */
		description:
			"Caps how many change requests one person can open in a time window.",
	},
	{
		ruleId: "max-files-changed",
		version: 1,
		name: "max files changed",
		blurb: "caps the number of files a change request may touch.",
		configSchema: maxFilesChangedConfigSchema,
		defaultConfig: { max: 200 },
		optIn: false,
		/** Toolbox one-liner (§editor rebuild, approved copy). */
		description: "Flags change requests that touch more files than you allow.",
	},
	{
		ruleId: "english-only",
		version: 1,
		name: "english only",
		blurb: "title/comment must be predominantly latin-script.",
		configSchema: englishOnlyConfigSchema,
		defaultConfig: { maxNonLatinRatio: 0.5 },
		optIn: false,
		/** Toolbox one-liner (§editor rebuild, approved copy). */
		description: "Flags titles and comments that aren't mostly latin script.",
	},
	{
		ruleId: "crypto-address",
		version: 1,
		name: "crypto address",
		blurb: "blocks cryptocurrency addresses in titles, comments, and diffs.",
		configSchema: cryptoAddressConfigSchema,
		defaultConfig: {},
		optIn: false,
		/** Toolbox one-liner (§editor rebuild, approved copy). */
		description:
			"Catches cryptocurrency addresses in titles, comments, and diffs.",
	},
	{
		ruleId: "honeypot",
		version: 1,
		name: "honeypot paths",
		blurb: "no legitimate change request touches these paths.",
		configSchema: honeypotConfigSchema,
		defaultConfig: { paths: [".github/workflows/**"] },
		optIn: false,
		/** Toolbox one-liner (§editor rebuild, approved copy). */
		description:
			"Catches change requests that touch paths no legitimate change would.",
	},
	{
		ruleId: "profile-readme",
		version: 1,
		name: "profile readme",
		blurb: "requires a minimum of profile text — identity investment.",
		configSchema: profileReadmeConfigSchema,
		defaultConfig: { minLength: 32 },
		optIn: false,
		/** Toolbox one-liner (§editor rebuild, approved copy). */
		description:
			"Requires a minimum of profile text — throwaway accounts rarely bother.",
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
		/** §6 (b) — what @2 changed vs the pinned prior version. */
		changeNote: "findings must quote code",
		/** Toolbox one-liner (§editor rebuild, approved copy). */
		description:
			"Reads the change like a reviewer and flags slop. Off until you turn it on — it costs tokens.",
	},
] as const;

export type RuleCatalogEntry = (typeof RULE_CATALOG)[number];

/**
 * The ONLY sanctioned splitter for the display layer: bare rule id from a wire
 * ref. `"min-merged-prs@2"` → `"min-merged-prs"`. The engine and workflow
 * validation split refs themselves; every user-facing surface goes through here
 * (and `ruleDisplayName`) instead, so no `.split("@")` scatters across the UI.
 */
export function ruleIdOf(ref: string): string {
	return ref.split("@")[0] ?? ref;
}

/**
 * A rule's human name for any user-facing surface (§12). Resolves by bare id, so
 * a frozen ref (`min-merged-prs@1`, `ai-review@1`) maps to the catalog name too —
 * names are stable across a rule's versions. Unknown ref ⇒ its bare id, never a
 * blank. NEVER contains the `@version` tag: that is engine identity, not copy.
 */
export function ruleDisplayName(ref: string): string {
	const id = ruleIdOf(ref);
	return RULE_CATALOG.find((entry) => entry.ruleId === id)?.name ?? id;
}

/**
 * The full catalog entry for a ref (name + description + config), or null for an
 * unknown ref. Serves consumers that need more than the name — e.g. the workflow
 * editor's node label + description lookup by ref.
 */
export function ruleCatalogEntry(ref: string): RuleCatalogEntry | null {
	const id = ruleIdOf(ref);
	return RULE_CATALOG.find((entry) => entry.ruleId === id) ?? null;
}

/**
 * One-line summary of what a rule's CURRENT version changed vs the prior one —
 * shown on the Rules page when a repo is pinned behind (§6 purpose b). Only the
 * rules that ever bumped a version carry one; everything else ⇒ null.
 */
export function ruleChangeNote(ref: string): string | null {
	const entry = ruleCatalogEntry(ref);
	return entry && "changeNote" in entry ? entry.changeNote : null;
}

/**
 * §9 — the readable-params layer. Display metadata for a rule's config, ONE
 * source of truth shared by the Rules page and the workflows editor's
 * properties panel. The zod `configSchema` above stays the VALIDATION truth
 * (the write path safe-parses against it); these descriptors add what zod
 * can't carry — units, percent rendering, human labels, and the sentence copy.
 * `rule-params.test.ts` welds the two: every param key must exist in the
 * schema, and the param defaults must match `defaultConfig` and pass the schema.
 */
export type RuleParam =
	| {
			key: string;
			label: string;
			kind: "number";
			int: boolean;
			min?: number;
			max?: number;
			/** Word that rides inline with the value: "days", "files", "steps"… */
			unit?: string;
			/** Stored as 0–1, shown and edited as a percentage (0.5 ⇒ "50%"). */
			percent?: boolean;
			default: number;
	  }
	| {
			key: string;
			label: string;
			kind: "string";
			default?: string;
			optional?: boolean;
			/** Hidden from the sentence + inline editing; visible in "view raw" only. */
			advanced?: boolean;
	  }
	| { key: string; label: string; kind: "boolean"; default: boolean }
	| {
			key: string;
			label: string;
			kind: "enum";
			options: readonly string[];
			default: string;
	  }
	| {
			key: string;
			label: string;
			kind: "string-list";
			default: readonly string[];
	  };

export interface RuleUiSchema {
	/**
	 * The config rendered as human sentences — ONE line per entry, each holding
	 * one or more `{key}` placeholders. Multi-param rules that read naturally as
	 * one line share a sentence (rate limit); ones that don't get a line per
	 * param (min-merged-prs). Empty ⇒ a param-less rule renders no config region.
	 */
	sentences: readonly string[];
	params: readonly RuleParam[];
}

/**
 * Per-rule display schema, keyed by rule id (version-agnostic — copy is stable
 * across a rule's versions, like the name). Beside the catalog; `satisfies`
 * type-checks every descriptor against `RuleUiSchema`.
 */
export const RULE_PARAMS = {
	"account-age": {
		sentences: ["blocks accounts younger than {minDays}"],
		params: [
			{
				key: "minDays",
				label: "minimum account age",
				kind: "number",
				int: true,
				min: 0,
				unit: "days",
				default: 7,
			},
		],
	},
	"min-merged-prs": {
		sentences: [
			"blocks contributors with fewer than {min} merged change request elsewhere",
			"trusts returning contributors after {trustedAfter} merge here",
		],
		params: [
			{
				key: "min",
				label: "minimum merges elsewhere",
				kind: "number",
				int: true,
				min: 0,
				default: 1,
			},
			{
				key: "trustedAfter",
				label: "local merges to trust",
				kind: "number",
				int: true,
				min: 1,
				default: 1,
			},
		],
	},
	"pr-rate-limit": {
		sentences: [
			"caps each contributor at {maxPerWindow} change requests per {windowHours}",
		],
		params: [
			{
				key: "maxPerWindow",
				label: "max change requests",
				kind: "number",
				int: true,
				min: 1,
				default: 5,
			},
			{
				key: "windowHours",
				label: "window",
				kind: "number",
				int: false,
				min: 0.1,
				unit: "hours",
				default: 24,
			},
		],
	},
	"max-files-changed": {
		sentences: ["blocks change requests that touch more than {max}"],
		params: [
			{
				key: "max",
				label: "max files",
				kind: "number",
				int: true,
				min: 1,
				unit: "files",
				default: 200,
			},
		],
	},
	"english-only": {
		sentences: [
			"blocks when more than {maxNonLatinRatio} of the text is non-latin script",
		],
		params: [
			{
				key: "maxNonLatinRatio",
				label: "max non-latin share",
				kind: "number",
				int: false,
				min: 0,
				max: 1,
				percent: true,
				default: 0.5,
			},
		],
	},
	"crypto-address": { sentences: [], params: [] },
	honeypot: {
		sentences: [
			"blocks any change request that touches {paths} — paths no legitimate change should need",
		],
		params: [
			{
				key: "paths",
				label: "protected paths",
				kind: "string-list",
				default: [".github/workflows/**"],
			},
		],
	},
	"profile-readme": {
		sentences: ["requires a profile bio of at least {minLength}"],
		params: [
			{
				key: "minLength",
				label: "minimum bio length",
				kind: "number",
				int: true,
				min: 1,
				unit: "characters",
				default: 32,
			},
		],
	},
	"ai-review": {
		sentences: ["reviews the change in up to {maxSteps}"],
		params: [
			{
				key: "maxSteps",
				label: "max analysis steps",
				kind: "number",
				int: true,
				min: 1,
				max: 15,
				unit: "steps",
				default: 12,
			},
			// COGS dial (Fable 5 vs Haiku ≈ 10× per the economics model) — kept out
			// of casual inline editing until pricing strategy owns model choice.
			{
				key: "model",
				label: "model",
				kind: "string",
				optional: true,
				advanced: true,
			},
		],
	},
} satisfies Record<string, RuleUiSchema>;

/** The display schema for a rule ref (version-agnostic), or null if unknown. */
export function ruleUiSchema(ref: string): RuleUiSchema | null {
	return (RULE_PARAMS as Record<string, RuleUiSchema>)[ruleIdOf(ref)] ?? null;
}

/**
 * Format a scalar param's value for the readable sentence — the ONE place the
 * unit/percent rules live, so display and tests agree. String-lists render as
 * chips in the component and are not handled here.
 */
export function formatParamValue(param: RuleParam, value: unknown): string {
	if (param.kind === "number") {
		const n = typeof value === "number" ? value : param.default;
		if (param.percent) {
			return `${Math.round(n * 100)}%`;
		}
		return param.unit ? `${n} ${param.unit}` : String(n);
	}
	if (param.kind === "string-list") {
		const arr = Array.isArray(value) ? (value as string[]) : [...param.default];
		return arr.join(", ");
	}
	if (param.kind === "boolean") {
		return value === true ? "on" : "off";
	}
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	return param.kind === "string" ? (param.default ?? "") : "";
}

/**
 * A rule's management state on the Rules page. Execution is WORKFLOW-ONLY: an
 * enabled workflow fully replaces standalone rule evaluation (run-workflows.ts —
 * `definitions = custom.length ? custom : [derived]`). So a rule is:
 *   standalone — no workflow enabled; its own config runs.
 *   managed    — its id is a rule node in an enabled workflow; the NODE's config
 *                is what runs, and edits happen in the workflow editor.
 *   dormant    — a workflow is enabled but doesn't include this rule, so it isn't
 *                evaluated at all until it's added to the workflow.
 */
export type RuleManagement = "standalone" | "managed" | "dormant";

export interface ResolvedRuleManagement {
	state: RuleManagement;
	/** Deep-link target: the owning workflow when managed, the first enabled
	 * workflow when dormant (a place to add the rule), null when standalone. */
	workflowId: string | null;
	/** For a MANAGED rule, the workflow node's config — what the executor walks,
	 * shown read-only so the card never displays a config that isn't running.
	 * null for standalone/dormant (they use the rule's own config). */
	managedConfig: JsonValue | null;
}

/**
 * Derive a rule's management state from the repo's ENABLED workflows. Pure and
 * keyed on node refs (`ruleIdOf`), so per-rule state comes from what the executor
 * would walk, never from a repo-level boolean.
 */
export function resolveRuleManagement(
	ruleId: string,
	enabledWorkflows: WorkflowDefinition[],
): ResolvedRuleManagement {
	if (enabledWorkflows.length === 0) {
		return { state: "standalone", workflowId: null, managedConfig: null };
	}
	for (const workflow of enabledWorkflows) {
		for (const node of workflow.nodes) {
			if (node.type === "rule" && ruleIdOf(node.ref) === ruleId) {
				return {
					state: "managed",
					workflowId: workflow.id,
					managedConfig: node.config,
				};
			}
		}
	}
	return {
		state: "dormant",
		workflowId: enabledWorkflows[0]?.id ?? null,
		managedConfig: null,
	};
}

/** A stored rule_configs row, as far as version resolution needs it. */
export interface StoredRuleConfig {
	ruleId: string;
	version: number;
	enabled: boolean;
	config: JsonValue;
}

/** The effective rule to run for a repo after the auto-advance policy (§6 b). */
export interface ResolvedRuleConfig {
	/** `id@version` to actually evaluate — current when advanced, pinned when held. */
	ref: string;
	enabled: boolean;
	config: JsonValue;
	/**
	 * True when the repo is HELD on an older version: it's pinned behind AND its
	 * saved config can't parse under the current version's schema, so advancing
	 * would silently discard the maintainer's settings. Held rules keep running
	 * their pinned (frozen, still-registered) version until an admin re-confirms.
	 */
	held: boolean;
}

/**
 * §6 (b) — the upgrade policy, applied at rule-evaluation resolve time. A repo
 * pins a config version (`rule_configs.version`); this decides the version it
 * ACTUALLY runs:
 *
 * - pinned ≥ current (or unknown rule): run as pinned — nothing to do.
 * - pinned < current, config still parses under the new schema: AUTO-ADVANCE to
 *   current, carrying the config forward. Lossless and silent — the set-and-
 *   forget path that covers ~all upgrades. No DB write: the pin is the config's
 *   schema anchor; the effective version is derived here on every evaluation.
 * - pinned < current, config CANNOT parse under the new schema: HOLD on the
 *   pinned version (the append-only law keeps it registered + running) and flag
 *   it, so an admin re-confirms rather than losing tuned settings to a silent
 *   reset.
 */
export function resolveEffectiveRuleConfig(
	row: StoredRuleConfig,
): ResolvedRuleConfig {
	const entry = RULE_CATALOG.find((e) => e.ruleId === row.ruleId);
	if (!entry || row.version >= entry.version) {
		return {
			ref: `${row.ruleId}@${row.version}`,
			enabled: row.enabled,
			config: row.config,
			held: false,
		};
	}
	const carriesForward = entry.configSchema.safeParse(row.config).success;
	return carriesForward
		? {
				ref: `${row.ruleId}@${entry.version}`,
				enabled: row.enabled,
				config: row.config,
				held: false,
			}
		: {
				ref: `${row.ruleId}@${row.version}`,
				enabled: row.enabled,
				config: row.config,
				held: true,
			};
}
