import { describe, expect, test } from "bun:test";
import {
	AI_REVIEW_MIN_CREDITS_USD,
	aiCreditsFromBalance,
	isAiOutOfCreditsError,
	openRouterCreditsSchema,
	openRouterKeySchema,
} from "./ai-provider.ts";
import { ruleResultSchema } from "./rules.ts";

const PROD_402_MESSAGE =
	"This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 4500. To increase, visit https://openrouter.ai/settings/credits and upgrade to a paid account";

describe("an out-of-credits provider error", () => {
	test("the prod 402 from OpenRouter reads as out of credits", () => {
		expect(
			isAiOutOfCreditsError({
				name: "AI_APICallError",
				statusCode: 402,
				message: PROD_402_MESSAGE,
			}),
		).toBe(true);
	});

	test("a 402 with no message still reads as out of credits", () => {
		expect(isAiOutOfCreditsError({ statusCode: 402 })).toBe(true);
	});

	test("the can-only-afford wording reads as out of credits on its own", () => {
		expect(isAiOutOfCreditsError(new Error(PROD_402_MESSAGE))).toBe(true);
		expect(
			isAiOutOfCreditsError(new Error("Insufficient credits on this account")),
		).toBe(true);
	});

	test("the error inside a retry wrapper or a cause still counts", () => {
		expect(
			isAiOutOfCreditsError({
				name: "AI_RetryError",
				message: "Failed after 3 attempts",
				lastError: { statusCode: 402 },
			}),
		).toBe(true);
		expect(
			isAiOutOfCreditsError(new Error("wrapped", { cause: { status: 402 } })),
		).toBe(true);
	});

	test("the limit source in the response body counts", () => {
		expect(
			isAiOutOfCreditsError({
				statusCode: 400,
				responseBody: JSON.stringify({
					error: {
						code: 402,
						message: "nope",
						metadata: { limit_source: "openrouter_credits" },
					},
				}),
			}),
		).toBe(true);
	});

	test("rate limits, budgets, outages and bugs are not out of credits", () => {
		expect(isAiOutOfCreditsError({ statusCode: 429 })).toBe(false);
		expect(isAiOutOfCreditsError({ statusCode: 403 })).toBe(false);
		expect(isAiOutOfCreditsError({ statusCode: 503 })).toBe(false);
		expect(isAiOutOfCreditsError(new TypeError("x is undefined"))).toBe(false);
		expect(isAiOutOfCreditsError(null)).toBe(false);
		expect(isAiOutOfCreditsError("402")).toBe(false);
	});

	test("a cyclic cause chain ends", () => {
		const a: { cause?: unknown } = {};
		const b = { cause: a };
		a.cause = b;
		expect(isAiOutOfCreditsError(a)).toBe(false);
	});
});

describe("the credit balance check", () => {
	test("an account balance under one review's reservation is out", () => {
		const credits = openRouterCreditsSchema.parse({
			data: { total_credits: 10, total_usage: 9.9 },
		});
		expect(aiCreditsFromBalance({ credits, key: null })).toBe("out");
	});

	test("an account balance that covers a review is ready", () => {
		const credits = openRouterCreditsSchema.parse({
			data: { total_credits: 10, total_usage: 2 },
		});
		expect(aiCreditsFromBalance({ credits, key: null })).toBe("ready");
	});

	test("a key at its spending limit is out even with account credits", () => {
		const credits = openRouterCreditsSchema.parse({
			data: { total_credits: 100, total_usage: 2 },
		});
		const key = openRouterKeySchema.parse({
			data: { limit: 5, limit_remaining: 0.01, usage: 4.99 },
		});
		expect(aiCreditsFromBalance({ credits, key })).toBe("out");
	});

	test("a key with no limit says nothing about the account balance", () => {
		const key = openRouterKeySchema.parse({
			data: { limit: null, limit_remaining: null, usage: 4.99 },
		});
		expect(aiCreditsFromBalance({ credits: null, key })).toBe("unknown");
	});

	test("the floor covers one review at the prod model's output price", () => {
		const reservedTokens = 65_536;
		const grokOutputPerMillion = 6.49;
		expect(AI_REVIEW_MIN_CREDITS_USD).toBeGreaterThanOrEqual(
			(reservedTokens / 1_000_000) * grokOutputPerMillion,
		);
	});
});

describe("a rule result that did not run for lack of credits", () => {
	test("carries its cause on the wire, and older results still parse", () => {
		const base = {
			ruleId: "ai-review",
			version: 2,
			status: "skipped" as const,
			passed: false,
			evidence: null,
			reason: "AI review did not run.",
			evaluatedAt: "2026-10-23T10:00:00.000Z",
		};
		expect(
			ruleResultSchema.parse({ ...base, cause: "ai-out-of-credits" }).cause,
		).toBe("ai-out-of-credits");
		expect(ruleResultSchema.parse(base).cause).toBeUndefined();
	});
});
