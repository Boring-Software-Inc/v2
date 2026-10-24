import { describe, expect, test } from "bun:test";
import {
	AI_CREDITS_COPY,
	AI_REVIEW_MIN_CREDITS_USD,
	type AiCreditsState,
	aiCreditsFromBalance,
	catalogWithAiCredits,
	isAiOutOfCreditsError,
	openRouterCreditsSchema,
	openRouterKeySchema,
	providerErrorSchema,
} from "./ai-provider.ts";
import {
	isAiReviewNotRunStep,
	RULE_CATALOG,
	ruleResultSchema,
} from "./rules.ts";
import type { WorkflowDefinition } from "./workflow.ts";
import { lintWorkflowReport } from "./workflow-lint.ts";
import {
	unrunnableIssues,
	validateWorkflowForEnable,
	workflowReadiness,
	workflowState,
} from "./workflow-validate.ts";

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
		expect(
			isAiOutOfCreditsError(
				providerErrorSchema.parse(new Error(PROD_402_MESSAGE)),
			),
		).toBe(true);
		expect(
			isAiOutOfCreditsError(
				providerErrorSchema.parse(
					new Error("Insufficient credits on this account"),
				),
			),
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
			isAiOutOfCreditsError(
				providerErrorSchema.parse(
					new Error("wrapped", { cause: { status: 402 } }),
				),
			),
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
		expect(
			isAiOutOfCreditsError(
				providerErrorSchema.parse(new TypeError("x is undefined")),
			),
		).toBe(false);
		expect(providerErrorSchema.safeParse(null).success).toBe(false);
		expect(providerErrorSchema.safeParse("402").success).toBe(false);
	});

	test("a cyclic cause chain ends", () => {
		const a = new Error("a");
		const b = new Error("b", { cause: a });
		a.cause = b;
		expect(isAiOutOfCreditsError(providerErrorSchema.parse(a))).toBe(false);
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

const AI_GATE: WorkflowDefinition = {
	id: "w",
	name: "w",
	version: 1,
	nodes: [
		{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
		{ id: "r", type: "rule", ref: "ai-review@2", config: { maxSteps: 12 } },
		{ id: "a", type: "action", action: "block" },
	],
	edges: [
		{ id: "e1", from: "t", to: "r" },
		{ id: "e2", from: "r", to: "a", when: "fail" },
	],
};

describe("a workflow with AI review while credits are out", () => {
	const out = catalogWithAiCredits(RULE_CATALOG, "out");

	test("still turns on: AI review is a bonus, not a requirement", () => {
		expect(validateWorkflowForEnable(AI_GATE, out).valid).toBe(true);
	});

	test("reads Live when on and Off when off, never Can't run", () => {
		const readiness = workflowReadiness(AI_GATE, out);
		expect(readiness).toMatchObject({ runnable: true, canTurnOn: true });
		expect(workflowState({ enabled: true, ...readiness })).toBe("on");
		expect(workflowState({ enabled: false, ...readiness })).toBe("off");
	});

	test("the AI review step says it can't run until credits return", () => {
		const report = lintWorkflowReport(AI_GATE, {
			catalog: out,
			stage: "enable",
		});
		expect(
			report.results.map((issue) => [
				issue.rule,
				issue.severity,
				issue.message,
			]),
		).toEqual([["rule-unavailable", "warning", AI_CREDITS_COPY.waiting]]);
	});

	test("with credits there is nothing to say", () => {
		const ready = catalogWithAiCredits(RULE_CATALOG, "ready");
		expect(validateWorkflowForEnable(AI_GATE, ready).valid).toBe(true);
		expect(
			lintWorkflowReport(AI_GATE, { catalog: ready, stage: "enable" }).results,
		).toEqual([]);
	});

	test("the worker's own wiring check is not touched by credits", () => {
		expect(unrunnableIssues(AI_GATE)).toEqual([]);
	});
});

describe("the credit state from every balance and key combination", () => {
	const account = {
		unread: null,
		empty: openRouterCreditsSchema.parse({
			data: { total_credits: 5, total_usage: 4.9 },
		}),
		funded: openRouterCreditsSchema.parse({
			data: { total_credits: 10, total_usage: 2 },
		}),
	};
	const keys = {
		unread: null,
		uncapped: openRouterKeySchema.parse({
			data: { limit: null, limit_remaining: null, usage: 1 },
		}),
		spent: openRouterKeySchema.parse({
			data: { limit: 5, limit_remaining: 0.01, usage: 4.99 },
		}),
		room: openRouterKeySchema.parse({
			data: { limit: 50, limit_remaining: 40, usage: 10 },
		}),
	};
	const cases: [
		keyof typeof account,
		keyof typeof keys,
		AiCreditsState | "unknown",
	][] = [
		["unread", "unread", "unknown"],
		["unread", "uncapped", "unknown"],
		["unread", "spent", "out"],
		["unread", "room", "unknown"],
		["empty", "unread", "out"],
		["empty", "uncapped", "out"],
		["empty", "spent", "out"],
		["empty", "room", "out"],
		["funded", "unread", "ready"],
		["funded", "uncapped", "ready"],
		["funded", "spent", "out"],
		["funded", "room", "ready"],
	];
	test.each(cases)("account %s, key %s: %s", (credits, key, state) => {
		expect(
			aiCreditsFromBalance({ credits: account[credits], key: keys[key] }),
		).toBe(state);
	});
});

describe("an AI review step that did not run", () => {
	const step = (
		status: string,
		ruleId: string,
		cause?: "ai-out-of-credits",
	) => ({
		status,
		output: ruleResultSchema.parse({
			ruleId,
			version: 2,
			status: status === "skipped" ? "skipped" : "evaluated",
			passed: status !== "skipped",
			evidence: null,
			reason: status === "skipped" ? "did not run" : undefined,
			cause,
			evaluatedAt: "2026-10-23T00:00:00.000Z",
		}),
	});

	test.each([
		[
			"skipped for credits",
			step("skipped", "ai-review", "ai-out-of-credits"),
			true,
		],
		["skipped with no key or a failure", step("skipped", "ai-review"), true],
		["evaluated", step("completed", "ai-review"), false],
		["another rule skipped", step("skipped", "account-age"), false],
		["no rule output", { status: "skipped", output: null }, false],
	])("%s", (_name, input, expected) => {
		expect(isAiReviewNotRunStep(input)).toBe(expected);
	});
});
