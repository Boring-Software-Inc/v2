import { z } from "zod";
import type { ValidationCatalogEntry } from "./workflow-lint.ts";

export const AI_REVIEW_RULE_ID = "ai-review";

export const AI_REVIEW_MIN_CREDITS_USD = 0.5;

export const aiCreditsStateSchema = z.enum(["ready", "out"]);
export type AiCreditsState = z.infer<typeof aiCreditsStateSchema>;

export const ruleSkipCauseSchema = z.enum(["ai-out-of-credits"]);
export type RuleSkipCause = z.infer<typeof ruleSkipCauseSchema>;

export const AI_CREDITS_COPY = {
	reason: "Out of AI credits",
	cantRun: "Tripwire is out of AI credits, so AI review can't run.",
	waiting: "AI review can't run until credits return.",
	notRun: "AI review did not run. Tripwire is out of AI credits.",
	notRunShort: "AI review did not run.",
} as const;

export function catalogWithAiCredits<T extends ValidationCatalogEntry>(
	catalog: readonly T[],
	credits: AiCreditsState,
): T[] {
	return catalog.map((entry) =>
		entry.ruleId === AI_REVIEW_RULE_ID && credits === "out"
			? { ...entry, unavailable: AI_CREDITS_COPY.waiting }
			: entry,
	);
}

const OUT_OF_CREDITS_TEXT =
	/can only afford|requires more credits|insufficient credits|out of credits|openrouter_credits|openrouter_key_limit/i;

const MAX_ERROR_DEPTH = 6;

export const providerErrorSchema = z.looseObject({
	statusCode: z.number().optional().catch(undefined),
	status: z.number().optional().catch(undefined),
	message: z.string().optional().catch(undefined),
	responseBody: z.string().optional().catch(undefined),
	lastError: z.unknown().optional(),
	cause: z.unknown().optional(),
	data: z.unknown().optional(),
	error: z.unknown().optional(),
	errors: z.array(z.unknown()).optional().catch(undefined),
});
export type ProviderError = z.infer<typeof providerErrorSchema>;

function nestedErrors(error: ProviderError): ProviderError[] {
	return [
		error.lastError,
		error.cause,
		error.data,
		error.error,
		...(error.errors ?? []),
	].flatMap((value) => {
		const parsed = providerErrorSchema.safeParse(value);
		return parsed.success ? [parsed.data] : [];
	});
}

function saysOutOfCredits(error: ProviderError): boolean {
	return (
		(error.statusCode ?? error.status) === 402 ||
		[error.message, error.responseBody].some(
			(text) => text !== undefined && OUT_OF_CREDITS_TEXT.test(text),
		)
	);
}

export function isAiOutOfCreditsError(error: ProviderError): boolean {
	let queue = [error];
	for (let depth = 0; depth < MAX_ERROR_DEPTH && queue.length > 0; depth++) {
		if (queue.some(saysOutOfCredits)) {
			return true;
		}
		queue = queue.flatMap(nestedErrors);
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

/**
 * A key's limit is a spending cap, not money, so it can only say "out".
 * "ready" needs a readable account balance at or above the floor.
 */
export function aiCreditsFromBalance(input: {
	credits: OpenRouterCredits | null;
	key: OpenRouterKey | null;
}): AiCreditsState | "unknown" {
	const keyRemaining = input.key?.data.limit_remaining;
	if (
		keyRemaining !== undefined &&
		keyRemaining !== null &&
		keyRemaining < AI_REVIEW_MIN_CREDITS_USD
	) {
		return "out";
	}
	if (!input.credits) {
		return "unknown";
	}
	const balance =
		input.credits.data.total_credits - input.credits.data.total_usage;
	return balance < AI_REVIEW_MIN_CREDITS_USD ? "out" : "ready";
}
