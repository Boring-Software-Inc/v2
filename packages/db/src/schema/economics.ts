import { sql } from "drizzle-orm";
import {
	boolean,
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { runSteps, runs } from "./runs.ts";

/**
 * Economics observability (economics-surface-contracts.md). Four tables, all
 * additive. This surface OBSERVES: nothing here participates in a run. Two raw
 * grains (ai_review_usage, usage_counters) feed one nightly rollup
 * (economics_daily) cross-checked against pulled invoices (provider_costs_daily).
 *
 * Reading rules: the UI and reports read economics_daily only. Raw tables are
 * audit and reprocessing. COGS math always filters source = 'prod'.
 */

/**
 * Raw metering grain. One row per generate() call (one ai-review step). Written
 * best-effort AFTER the run persists, so a metering outage never touches a run.
 * `source` separates COGS (prod) from R&D (eval, dev); it is derived from which
 * OpenRouter key served the call, never guessed. `orgId` null = unattributed
 * (an unclaimed install); surfaced, never hidden.
 */
export const aiReviewUsage = pgTable(
	"ai_review_usage",
	{
		id: text("id").primaryKey(),
		runStepId: text("run_step_id")
			.notNull()
			.references(() => runSteps.id),
		runId: text("run_id")
			.notNull()
			.references(() => runs.id),
		orgId: text("org_id"),
		model: text("model").notNull(),
		/** Model steps taken = OpenRouter HTTP requests for this call (trace.stepsUsed). */
		httpRequests: integer("http_requests").notNull(),
		promptTokens: integer("prompt_tokens").notNull(),
		completionTokens: integer("completion_tokens").notNull(),
		cachedTokens: integer("cached_tokens"),
		/** Summed per-step cost from OpenRouter usage accounting. Null when unavailable. */
		costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
		source: text("source").notNull().default("prod"),
		/** One-time backfill from stored run_steps traces (cost_usd null on those). */
		backfilled: boolean("backfilled").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		// One generate() call = one ai-review step = one row. Unique on the step
		// makes both the live write and the backfill idempotent on retry.
		uniqueIndex("ai_review_usage_run_step_unique").on(t.runStepId),
		index("ai_review_usage_org_created_idx").on(t.orgId, t.createdAt),
		index("ai_review_usage_run_idx").on(t.runId),
		index("ai_review_usage_source_created_idx").on(t.source, t.createdAt),
	],
);

/**
 * Per-run resource counters. One row per run, written once at run completion
 * (best-effort). GitHub API traffic and OpenRouter request bytes, plus the
 * summed step duration as active compute. Apportions the worker's Railway
 * minutes to runs vs idle.
 */
export const usageCounters = pgTable(
	"usage_counters",
	{
		runId: text("run_id")
			.primaryKey()
			.references(() => runs.id),
		orgId: text("org_id"),
		githubApiCalls: integer("github_api_calls").notNull().default(0),
		githubBytesIn: integer("github_bytes_in").notNull().default(0),
		githubBytesOut: integer("github_bytes_out").notNull().default(0),
		openrouterBytesOut: integer("openrouter_bytes_out").notNull().default(0),
		/** Sum of run step duration_ms — active run compute. */
		activeMs: integer("active_ms").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("usage_counters_org_created_idx").on(t.orgId, t.createdAt)],
);

/**
 * Invoice side. One row per provider/service/day, written by the pull cron.
 * `usageJson` keeps the raw provider-shaped metrics for audit; `costUsd` is the
 * extracted dollar figure the rollup reads. Kept forever.
 */
export const providerCostsDaily = pgTable(
	"provider_costs_daily",
	{
		day: date("day").notNull(),
		/** railway | openrouter | planetscale */
		provider: text("provider").notNull(),
		/** worker | api | web | prod-key | eval-key | main */
		service: text("service").notNull(),
		usageJson: jsonb("usage_json").notNull(),
		costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull(),
		/** True when the figure is interpolated (e.g. PlanetScale monthly / days). */
		estimated: boolean("estimated").notNull().default(false),
		pulledAt: timestamp("pulled_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.day, t.provider, t.service] })],
);

/**
 * The only table the UI and reports read. Written by the nightly rollup: one
 * row per org active that day, plus a null-org row carrying the daily totals
 * and reconciliation (pulled cost, drift, credit balance, Railway usage).
 *
 * Uniqueness is a null-safe index, NOT a primary key: a primary key would force
 * org_id NOT NULL and the totals row needs org_id null. The sentinel keeps the
 * (day, org) pair unique while the null row stays visible (reading rule 4).
 */
export const economicsDaily = pgTable(
	"economics_daily",
	{
		day: date("day").notNull(),
		orgId: text("org_id"),
		runs: integer("runs").notNull().default(0),
		aiReviewedRuns: integer("ai_reviewed_runs").notNull().default(0),
		promptTokens: integer("prompt_tokens").notNull().default(0),
		completionTokens: integer("completion_tokens").notNull().default(0),
		meteredCostUsd: numeric("metered_cost_usd", {
			precision: 10,
			scale: 6,
		}).notNull(),
		/** Totals row only (org_id null): runs and cost whose repo has no org
		 * (unclaimed install). A growing figure is a bug signal (reading rule 4). */
		unattributedRuns: integer("unattributed_runs"),
		unattributedCostUsd: numeric("unattributed_cost_usd", {
			precision: 10,
			scale: 6,
		}),
		/** Totals row only (org_id null): */
		pulledCostUsd: numeric("pulled_cost_usd", { precision: 10, scale: 4 }),
		driftPct: numeric("drift_pct", { precision: 5, scale: 2 }),
		creditBalanceUsd: numeric("credit_balance_usd", { precision: 8, scale: 2 }),
		railwayUsageUsd: numeric("railway_usage_usd", { precision: 6, scale: 2 }),
	},
	(t) => [
		uniqueIndex("economics_daily_day_org_unique").on(
			t.day,
			sql`coalesce(${t.orgId}, '~platform')`,
		),
		index("economics_daily_org_idx").on(t.orgId),
	],
);
