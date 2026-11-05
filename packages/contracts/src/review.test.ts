import { describe, expect, test } from "bun:test";
import {
	AI_REVIEW_TRACE_MAX_STEPS,
	AI_REVIEW_TRACE_STEP_CHARS,
	aiReviewTraceSchema,
	boundAiReviewTrace,
	openRouterStepCostSchema,
} from "./review.ts";

/**
 * §8 — the trace is bounded at the source so attacker-influenced model output
 * can't dictate what gets written to run_steps. Caps are hard, truncation marked.
 */
describe("boundAiReviewTrace", () => {
	test("a reasoning step over the char cap is truncated and marked", () => {
		const t = boundAiReviewTrace({
			model: "m",
			maxSteps: 12,
			rawSteps: [{ text: "x".repeat(AI_REVIEW_TRACE_STEP_CHARS + 500) }],
			usage: { inputTokens: 10, outputTokens: 5 },
		});
		expect(t.steps[0]?.type).toBe("reasoning");
		expect(t.steps[0]?.truncated).toBe(true);
		expect(t.steps[0]?.excerpt.length).toBe(AI_REVIEW_TRACE_STEP_CHARS);
	});

	test("a short step is not marked truncated", () => {
		const t = boundAiReviewTrace({
			model: "m",
			maxSteps: 12,
			rawSteps: [{ text: "brief thought" }],
			usage: undefined,
		});
		expect(t.steps[0]?.truncated).toBe(false);
		expect(t.steps[0]?.excerpt).toBe("brief thought");
	});

	test("tool calls become tool_call steps with the tool name", () => {
		const t = boundAiReviewTrace({
			model: "m",
			maxSteps: 12,
			rawSteps: [
				{ toolCalls: [{ toolName: "read_file", input: { path: "a.ts" } }] },
			],
			usage: undefined,
		});
		expect(t.steps[0]?.type).toBe("tool_call");
		expect(t.steps[0]?.toolName).toBe("read_file");
		expect(t.steps[0]?.excerpt).toContain("a.ts");
	});

	test("tool input serialization keeps raw strings and JSON fallback", () => {
		const inputs = [
			"",
			"plain text",
			null,
			undefined,
			3,
			false,
			["a", null, {}],
		];
		const trace = boundAiReviewTrace({
			model: "m",
			maxSteps: 12,
			rawSteps: [
				{ toolCalls: inputs.map((input) => ({ toolName: "tool", input })) },
			],
			usage: undefined,
		});
		expect(trace.steps.map((step) => step.excerpt)).toEqual([
			"",
			"plain text",
			"{}",
			"{}",
			"3",
			"false",
			'["a",null,{}]',
		]);
	});

	test("cached usage preserves zero and numeric values without coercion", () => {
		for (const cachedInputTokens of [0, NaN, Infinity, -Infinity]) {
			const trace = boundAiReviewTrace({
				model: "m",
				maxSteps: 12,
				rawSteps: [],
				usage: { cachedInputTokens },
			});
			expect(trace.usage.cached).toBe(cachedInputTokens);
		}
	});

	test("display steps beyond the cap are dropped and trimmed is marked", () => {
		const raw = Array.from(
			{ length: AI_REVIEW_TRACE_MAX_STEPS + 6 },
			(_, i) => ({
				text: `step ${i}`,
			}),
		);
		const t = boundAiReviewTrace({
			model: "m",
			maxSteps: 15,
			rawSteps: raw,
			usage: undefined,
		});
		expect(t.trimmed).toBe(true);
		expect(t.steps.length).toBe(AI_REVIEW_TRACE_MAX_STEPS);
		// stepsUsed is the model's real count, not the displayed (trimmed) length
		expect(t.stepsUsed).toBe(raw.length);
	});

	test("usage: cached is null when the provider omits it, a number when present", () => {
		const without = boundAiReviewTrace({
			model: "m",
			maxSteps: 12,
			rawSteps: [],
			usage: { inputTokens: 100, outputTokens: 20 },
		});
		expect(without.usage.cached).toBeNull();
		expect(without.usage.input).toBe(100);

		const withCache = boundAiReviewTrace({
			model: "m",
			maxSteps: 12,
			rawSteps: [],
			usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80 },
		});
		expect(withCache.usage.cached).toBe(80);
	});

	test("the bounded trace validates against its own schema", () => {
		const t = boundAiReviewTrace({
			model: "anthropic/claude-fable-5",
			maxSteps: 12,
			rawSteps: [
				{ text: "ok" },
				{ toolCalls: [{ toolName: "get_commits", input: {} }] },
			],
			usage: { inputTokens: 1, outputTokens: 1 },
		});
		expect(aiReviewTraceSchema.safeParse(t).success).toBe(true);
	});
});

describe("openRouterStepCostSchema", () => {
	test("preserves finite numbers without coercing or constraining their sign", () => {
		for (const cost of [0, -0, -0.5, 0.125]) {
			expect(
				openRouterStepCostSchema.parse({
					usage: { cost, tokens: 4 },
					extra: true,
				}).usage.cost,
			).toBe(cost);
		}
	});

	test("ignores absent, malformed and non-finite costs", () => {
		for (const metadata of [
			undefined,
			null,
			{},
			[],
			{ usage: null },
			{ usage: {} },
			...["0.2", null, NaN, Infinity, -Infinity].map((cost) => ({
				usage: { cost },
			})),
		]) {
			expect(openRouterStepCostSchema.safeParse(metadata).success).toBe(false);
		}
	});

	test("reads inherited usage and cost like the provider property projection", () => {
		const usage = Object.create({ cost: 0.25 });
		expect(
			openRouterStepCostSchema.parse(Object.create({ usage })).usage.cost,
		).toBe(0.25);
	});

	test("invalid cost formatting does not inspect hostile values", () => {
		const hostile = {
			get toJSON() {
				throw new Error("unexpected property read");
			},
		};
		expect(
			openRouterStepCostSchema.safeParse({ usage: { cost: hostile } }).success,
		).toBe(false);
	});
});
