import { z } from "zod";

/**
 * Review domain (spec §4 `review.ts`, §8 verbatim) — the schema IS the muzzle.
 * The presenter physically cannot write an essay: one bounded sentence, at
 * most five findings. Findings render on the run page, never in the comment.
 */

export const findingSeveritySchema = z.enum(["info", "warn", "critical"]);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

export const findingSchema = z.object({
	severity: findingSeveritySchema,
	file: z.string(),
	line: z.number().int().min(1).optional(),
	note: z.string().max(240),
});
export type Finding = z.infer<typeof findingSchema>;

export const aiReviewOutputSchema = z.object({
	verdict: z.enum(["pass", "block", "needs_review"]),
	/** 0–1. */
	confidence: z.number().min(0).max(1),
	/** ONE sentence, hard length limit. */
	summary: z.string().max(200),
	/** Max 5. */
	findings: z.array(findingSchema).max(5),
});
export type AiReviewOutput = z.infer<typeof aiReviewOutputSchema>;

/**
 * Config for ai-review@1 — the model is a config string (§8). When omitted,
 * the worker's AI_REVIEW_MODEL env supplies the default (explicit config
 * wins).
 */
export const aiReviewConfigSchema = z.object({
	model: z.string().optional(),
	maxSteps: z.number().int().min(1).max(15).default(12),
});

/**
 * The bounded ai-review reasoning trace (§8). Persists per evaluation as gated
 * evidence (maintainer-only). BEFORE this bounding, the trace was written to
 * run_steps unbounded: a looping or hostile model could store 100 KB+ of
 * attacker-influenced text per review. Caps are hard. Truncation is marked in
 * the data, never silent. The trace's rule version comes from its run step's
 * ruleId (ai-review@2), not a second copy here.
 */
export const AI_REVIEW_TRACE_STEP_CHARS = 2000;
export const AI_REVIEW_TRACE_MAX_STEPS = 15;

export const aiReviewTraceStepSchema = z.object({
	type: z.enum(["reasoning", "tool_call"]),
	toolName: z.string().optional(),
	/** Truncated excerpt of the step content. Attacker-influenced: render as plain text. */
	excerpt: z.string(),
	/** The excerpt was cut at the per-step cap. */
	truncated: z.boolean(),
});
export type AiReviewTraceStep = z.infer<typeof aiReviewTraceStepSchema>;

export const aiReviewTraceSchema = z.object({
	model: z.string(),
	/** Model steps taken vs the configured cap. */
	stepsUsed: z.number().int().min(0),
	maxSteps: z.number().int().min(0),
	/** Display steps beyond the cap were dropped. */
	trimmed: z.boolean(),
	/**
	 * Summed OpenRouter cost for the call (all steps), in USD. Null when the
	 * provider did not report cost. Optional so pre-cost stored runs still parse.
	 */
	costUsd: z.number().nullable().optional(),
	usage: z.object({
		input: z.number().int().min(0),
		output: z.number().int().min(0),
		/** null when the model provider does not report cached tokens (measured, not assumed). */
		cached: z.number().int().min(0).nullable(),
	}),
	steps: z.array(aiReviewTraceStepSchema),
});
export type AiReviewTrace = z.infer<typeof aiReviewTraceSchema>;

interface RawTraceStep {
	text?: string;
	toolCalls?: { toolName: string; input: unknown }[];
}
interface RawUsage {
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
}

function excerpt(text: string): { excerpt: string; truncated: boolean } {
	if (text.length <= AI_REVIEW_TRACE_STEP_CHARS) {
		return { excerpt: text, truncated: false };
	}
	return {
		excerpt: text.slice(0, AI_REVIEW_TRACE_STEP_CHARS),
		truncated: true,
	};
}

/**
 * Convert the model SDK's raw steps into a bounded, persistable trace. Reasoning
 * text and each tool call become one display step; excerpts are capped per step
 * and the display list is capped in total, both marked. `stepsUsed` is the
 * model's own step count (may exceed the displayed list when trimmed).
 */
export function boundAiReviewTrace(input: {
	model: string;
	maxSteps: number;
	rawSteps: RawTraceStep[];
	usage: RawUsage | undefined;
	/** Summed provider cost across steps, USD. Null when unreported. */
	costUsd?: number | null;
}): AiReviewTrace {
	const steps: AiReviewTraceStep[] = [];
	for (const raw of input.rawSteps) {
		if (raw.text && raw.text.trim().length > 0) {
			steps.push({ type: "reasoning", ...excerpt(raw.text) });
		}
		for (const call of raw.toolCalls ?? []) {
			steps.push({
				type: "tool_call",
				toolName: call.toolName,
				...excerpt(
					typeof call.input === "string"
						? call.input
						: JSON.stringify(call.input ?? {}),
				),
			});
		}
	}
	const trimmed = steps.length > AI_REVIEW_TRACE_MAX_STEPS;
	const usage = input.usage ?? {};
	return {
		model: input.model,
		stepsUsed: input.rawSteps.length,
		maxSteps: input.maxSteps,
		trimmed,
		costUsd: input.costUsd ?? null,
		usage: {
			input: usage.inputTokens ?? 0,
			output: usage.outputTokens ?? 0,
			cached:
				typeof usage.cachedInputTokens === "number"
					? usage.cachedInputTokens
					: null,
		},
		steps: trimmed ? steps.slice(0, AI_REVIEW_TRACE_MAX_STEPS) : steps,
	};
}
