import { z } from "zod";

export const ACTIVITY_VERDICTS = [
	"all",
	"block",
	"needs_review",
	"pass",
	"no-run",
] as const;

export type ActivityVerdict = (typeof ACTIVITY_VERDICTS)[number];

export const ACTIVITY_SEARCH_DEFAULTS = { verdict: "all" } as const;

export const activitySearchSchema = z.object({
	verdict: z
		.enum(ACTIVITY_VERDICTS)
		.default(ACTIVITY_SEARCH_DEFAULTS.verdict)
		.catch(ACTIVITY_SEARCH_DEFAULTS.verdict),
});

export const ANALYTICS_METRICS = ["review", "blocked", "passed"] as const;

export type AnalyticsMetricKey = (typeof ANALYTICS_METRICS)[number];

export const ANALYTICS_SEARCH_DEFAULTS = { metric: "review" } as const;

export const analyticsSearchSchema = z.object({
	metric: z
		.enum(ANALYTICS_METRICS)
		.default(ANALYTICS_SEARCH_DEFAULTS.metric)
		.catch(ANALYTICS_SEARCH_DEFAULTS.metric),
});

export const RESPONSE_SCOPES = [
	"block",
	"changes_required",
	"needs_review",
	"note",
	"close",
	"redaction",
] as const;

export type ResponseScope = (typeof RESPONSE_SCOPES)[number];

export const RESPONSES_SEARCH_DEFAULTS = { scope: "block" } as const;

export const responsesSearchSchema = z.object({
	scope: z
		.enum(RESPONSE_SCOPES)
		.default(RESPONSES_SEARCH_DEFAULTS.scope)
		.catch(RESPONSES_SEARCH_DEFAULTS.scope),
});
