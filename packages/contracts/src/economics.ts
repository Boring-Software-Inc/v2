import { z } from "zod";

/**
 * Economics observability contracts (economics-surface-contracts.md). Constants,
 * the COGS source enum, and the pure helpers the worker and web share. No I/O,
 * no env reads here — the worker reads env and passes values in.
 */

/** Accrued PlanetScale cost per month (flat across scenarios). */
export const PLANETSCALE_MONTHLY = 45.0;
/** PlanetScale credit balance at the start of tracking. */
export const PLANETSCALE_CREDITS_START = 1000.0;
/** Railway Hobby floor with included usage. Usage under this bills flat. */
export const RAILWAY_FLOOR = 5.0;
/**
 * OpenRouter platform fee on credit purchases. Metered and pulled costs are
 * inference dollars; cash COGS = inference x this. Apply ONLY in the monthly
 * report cash view, never in drift math.
 */
export const OR_CREDIT_FEE_MULTIPLIER = 1.055;

/**
 * The AI review model and its OpenRouter list price (x-ai/grok-4.5). Surfaced in
 * the digest so a reader knows what drives per-review cost. This is the sticker
 * rate, not the cache-adjusted effective rate; update it when xAI's pricing
 * moves. Cost math never reads this — metered cost is the provider-reported
 * figure per call (review.ts) — so a stale number here only misprints a label.
 */
export const REVIEW_MODEL = {
	id: "x-ai/grok-4.5",
	label: "grok-4.5",
	inputUsdPerMTok: 2.0,
	outputUsdPerMTok: 6.0,
} as const;

/** Default alert thresholds. Each is env-overridable in the worker. */
export const OR_DAILY_CAP_USD = 1.0;
export const DRIFT_ALERT_PCT = 10;
export const RAILWAY_FLOOR_WARN_USD = 4.5;

/**
 * COGS source. `prod` is customer-run inference and the ONLY source COGS math
 * sums. `eval` and `dev` are R&D, excluded. Derived from which OpenRouter key
 * or env served the call, never guessed; underivable writes `dev`.
 */
export const usageSourceSchema = z.enum(["prod", "eval", "dev"]);
export type UsageSource = z.infer<typeof usageSourceSchema>;

/** Cost providers pulled by the pull-provider-costs cron. */
export const economicsProviderSchema = z.enum([
	"railway",
	"openrouter",
	"planetscale",
]);
export type EconomicsProvider = z.infer<typeof economicsProviderSchema>;

/**
 * Derive the COGS source from the run environment, purely. `keyKind` names which
 * OpenRouter key served the call: `prod` and `eval` map straight through;
 * anything else (a local key, a shared fallback, an unknown) is `dev`. The
 * worker computes `keyKind` from which env var supplied the key.
 */
export function deriveUsageSource(input: {
	keyKind: "prod" | "eval" | "dev" | null;
	isProdEnv: boolean;
}): UsageSource {
	if (input.keyKind === "eval") {
		return "eval";
	}
	if (input.keyKind === "prod" && input.isProdEnv) {
		return "prod";
	}
	return "dev";
}

/**
 * Months of runway left on the PlanetScale credit at the current accrued burn.
 * Pure arithmetic, surfaced in the digest and the admin page.
 */
export function creditRunwayMonths(balanceUsd: number): number {
	if (PLANETSCALE_MONTHLY <= 0) {
		return Number.POSITIVE_INFINITY;
	}
	return balanceUsd / PLANETSCALE_MONTHLY;
}
