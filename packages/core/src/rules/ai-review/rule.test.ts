import { describe, expect, test } from "bun:test";
import type { AiReviewOutput } from "@tripwire/contracts";
import { evaluateRule } from "../define.ts";
import { fixtureContext } from "../test-context.ts";
import { aiReview } from "./rule.ts";

const CONFIG = { model: "claude-fable-5", maxSteps: 12 };

function mockGenerate(output: unknown, trace: unknown = { tokens: 42 }) {
	const calls: { instructions: string; prompt: string }[] = [];
	const generate = (req: { instructions: string; prompt: string }) => {
		calls.push(req);
		return Promise.resolve({ output, trace });
	};
	return { generate, calls };
}

const PASS_OUTPUT: AiReviewOutput = {
	verdict: "pass",
	confidence: 0.92,
	summary: "focused fix, does what the title says.",
	findings: [],
};

describe("ai-review@1", () => {
	test("pass verdict ⇒ passed, evidence carries output + trace", async () => {
		const { generate, calls } = mockGenerate(PASS_OUTPUT);
		const ctx = await fixtureContext({ generate });
		const result = await evaluateRule(aiReview, ctx, CONFIG);
		expect(result.status).toBe("evaluated");
		expect(result.passed).toBe(true);
		const evidence = result.evidence as {
			output: AiReviewOutput;
			trace: { tokens: number };
		};
		expect(evidence.output.verdict).toBe("pass");
		expect(evidence.trace.tokens).toBe(42);
		expect(calls[0]?.instructions).toContain("submit_review");
		expect(calls[0]?.prompt).toContain("Codertocat/Hello-World");
	});

	test("block verdict ⇒ failed with findings in evidence", async () => {
		const { generate } = mockGenerate({
			verdict: "block",
			confidence: 0.97,
			summary: "workflow tampering plus a payload fetch.",
			findings: [
				{
					severity: "critical",
					file: ".github/workflows/ci.yml",
					line: 12,
					note: "adds a curl | sh step against an unknown host",
				},
			],
		} satisfies AiReviewOutput);
		const ctx = await fixtureContext({ generate });
		const result = await evaluateRule(aiReview, ctx, CONFIG);
		expect(result.passed).toBe(false);
		expect(result.status).toBe("evaluated");
	});

	test("needs_review verdict ⇒ failed (composes toward moderation)", async () => {
		const { generate } = mockGenerate({
			...PASS_OUTPUT,
			verdict: "needs_review",
			summary: "smells wrong but evidence is inconclusive.",
		});
		const result = await evaluateRule(
			aiReview,
			await fixtureContext({ generate }),
			CONFIG,
		);
		expect(result.passed).toBe(false);
	});

	test("no injected generate ⇒ skipped, never a throw", async () => {
		const result = await evaluateRule(aiReview, await fixtureContext(), CONFIG);
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("generate unavailable");
	});

	test("essay output (schema violation) ⇒ skipped — the muzzle holds", async () => {
		const { generate } = mockGenerate({
			verdict: "pass",
			confidence: 0.5,
			summary: "x".repeat(500),
			findings: [],
		});
		const result = await evaluateRule(
			aiReview,
			await fixtureContext({ generate }),
			CONFIG,
		);
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("muzzle");
	});

	test("more than 5 findings ⇒ skipped", async () => {
		const finding = {
			severity: "info" as const,
			file: "a.ts",
			note: "n",
		};
		const { generate } = mockGenerate({
			...PASS_OUTPUT,
			findings: Array.from({ length: 6 }, () => finding),
		});
		const result = await evaluateRule(
			aiReview,
			await fixtureContext({ generate }),
			CONFIG,
		);
		expect(result.status).toBe("skipped");
	});

	test("comment events are skipped (not a change request)", async () => {
		const { generate } = mockGenerate(PASS_OUTPUT);
		const { fixtureEvent } = await import("../test-context.ts");
		const result = await evaluateRule(
			aiReview,
			await fixtureContext({
				generate,
				event: await fixtureEvent("comment.created.event"),
			}),
			CONFIG,
		);
		expect(result.status).toBe("skipped");
	});
});
