/**
 * AI-review eval config. One block for models, thresholds, budget, and pricing.
 * Evals run local/dev only. They call the OpenRouter model API and nothing else:
 * no database, no prod infrastructure.
 */

/** The model Tripwire actually ships as its reviewer. `--prod-model` runs the
 * premium upgrade candidate instead, for the "does paying more buy precision" read. */
export const DEFAULT_EVAL_MODEL = "x-ai/grok-4.5";
export const PROD_MODEL =
	process.env.EVAL_COMPARE_MODEL ?? "anthropic/claude-fable-5";

export const RUNS_PER_FIXTURE = Number(process.env.EVAL_RUNS ?? 3);
/** A fixture passes at this share of runs agreeing with its expected verdict. */
export const AGREEMENT_THRESHOLD = 2 / 3;
/** Clear-cut fixtures must all pass. Borderline ones are reported, not blocking. */
export const CLEARCUT_PASS_RATE = 1;

/** Hard budget cap in output-equivalent tokens; the run aborts before exceeding it. */
export const BUDGET_TOKENS = Number(
	process.env.EVAL_BUDGET_TOKENS ?? 3_000_000,
);
/** Rough per-run token estimate for the pre-run budget guard. */
export const EST_TOKENS_PER_RUN = 20_000;

/**
 * Model pricing, US dollars per 1M tokens. Retrieved 2026-07-17 from the
 * infra cost audit (OpenRouter list prices). `cachedIn` is the cached-read rate;
 * we still MEASURE actual cached tokens rather than assume the caching savings.
 */
export const PRICING_RETRIEVED = "2026-07-17";
interface ModelPricing {
	in: number;
	out: number;
	cachedIn: number;
}

interface ModelPricingTable {
	[model: string]: ModelPricing;
}

export const PRICING: ModelPricingTable = {
	// Grok 4.5 (openrouter.ai/x-ai/grok-4.5) — <200K prompt; doubles at >=200K.
	"x-ai/grok-4.5": { in: 2, out: 6, cachedIn: 0.5 },
	"anthropic/claude-haiku-4.5": { in: 1, out: 5, cachedIn: 0.1 },
	"anthropic/claude-sonnet-4.6": { in: 3, out: 15, cachedIn: 0.3 },
	"anthropic/claude-opus-4.8": { in: 5, out: 25, cachedIn: 0.5 },
	"anthropic/claude-fable-5": { in: 10, out: 50, cachedIn: 1 },
};

/** Cost in USD for one review's token usage. Unknown model ⇒ 0 with a flag. */
export function costUsd(
	model: string,
	tokens: { input: number; output: number; cached: number },
): number {
	const p = PRICING[model];
	if (!p) {
		return 0;
	}
	const fresh = Math.max(0, tokens.input - tokens.cached);
	return (
		(fresh * p.in + tokens.cached * p.cachedIn + tokens.output * p.out) /
		1_000_000
	);
}

export function isPriced(model: string): boolean {
	return model in PRICING;
}
