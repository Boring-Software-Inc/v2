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
