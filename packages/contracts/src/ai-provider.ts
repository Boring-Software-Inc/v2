import { z } from "zod";

export const AI_REVIEW_RULE_ID = "ai-review";

export const AI_REVIEW_MIN_CREDITS_USD = 0.5;

export const aiCreditsStateSchema = z.enum(["ready", "out"]);
export type AiCreditsState = z.infer<typeof aiCreditsStateSchema>;

export const ruleSkipCauseSchema = z.enum(["ai-out-of-credits"]);
export type RuleSkipCause = z.infer<typeof ruleSkipCauseSchema>;

export const AI_CREDITS_COPY = {
	reason: "Out of AI credits",
	refuseTurnOn: "Tripwire is out of AI credits, so AI review can't turn on.",
	notRun: "AI review did not run. Tripwire is out of AI credits.",
	notRunShort: "AI review did not run.",
} as const;

const OUT_OF_CREDITS_TEXT =
	/can only afford|requires more credits|insufficient credits|out of credits|openrouter_credits|openrouter_key_limit/i;

const MAX_ERROR_DEPTH = 6;

function field(value: object, key: string): unknown {
	return key in value ? (value as Record<string, unknown>)[key] : undefined;
}

export function isAiOutOfCreditsError(error: unknown): boolean {
	const seen = new Set<unknown>();
	let queue: unknown[] = [error];
	for (let depth = 0; depth < MAX_ERROR_DEPTH && queue.length > 0; depth++) {
		const next: unknown[] = [];
		for (const item of queue) {
			if (typeof item !== "object" || item === null || seen.has(item)) {
				continue;
			}
			seen.add(item);
			const status = field(item, "statusCode") ?? field(item, "status");
			if (status === 402) {
				return true;
			}
			for (const key of ["message", "responseBody"]) {
				const text = field(item, key);
				if (typeof text === "string" && OUT_OF_CREDITS_TEXT.test(text)) {
					return true;
				}
			}
			next.push(
				field(item, "lastError"),
				field(item, "cause"),
				field(item, "data"),
				field(item, "error"),
			);
			const errors = field(item, "errors");
			if (Array.isArray(errors)) {
				next.push(...errors);
			}
		}
		queue = next;
	}
	return false;
}

export const openRouterCreditsSchema = z.object({
	data: z.object({
		total_credits: z.number(),
		total_usage: z.number(),
	}),
});
export type OpenRouterCredits = z.infer<typeof openRouterCreditsSchema>;

export const openRouterKeySchema = z.object({
	data: z.object({
		limit: z.number().nullable().optional(),
		limit_remaining: z.number().nullable().optional(),
		usage: z.number().optional(),
	}),
});
export type OpenRouterKey = z.infer<typeof openRouterKeySchema>;

export function aiCreditsFromBalance(input: {
	credits: OpenRouterCredits | null;
	key: OpenRouterKey | null;
}): AiCreditsState | "unknown" {
	const remaining: number[] = [];
	if (input.credits) {
		remaining.push(
			input.credits.data.total_credits - input.credits.data.total_usage,
		);
	}
	const keyRemaining = input.key?.data.limit_remaining;
	if (typeof keyRemaining === "number") {
		remaining.push(keyRemaining);
	}
	if (remaining.length === 0) {
		return "unknown";
	}
	return Math.min(...remaining) < AI_REVIEW_MIN_CREDITS_USD ? "out" : "ready";
}
