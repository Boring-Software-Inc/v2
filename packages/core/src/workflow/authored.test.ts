import { describe, expect, test } from "bun:test";
import {
	compileWorkflows,
	type RuleResult,
	type WorkflowDefinition,
	workflowAuthoring,
} from "@tripwire/contracts";
import { fixtureEvent } from "../rules/test-context.ts";
import { executeWorkflow } from "./executor.ts";

const { anyOf, block, check, requestReview, workflow, workflows } =
	workflowAuthoring;

function only(file: unknown): WorkflowDefinition {
	const result = compileWorkflows(file);
	if (!(result.ok && result.definitions[0])) {
		throw new Error("fixture does not compile");
	}
	return result.definitions[0];
}

const GATE = only(
	workflows({
		"change-request-opens": workflow({
			on: "change-request.opened",
			check: anyOf(
				check("account-age", { minDays: 7 }).fails,
				check("pr-rate-limit", { maxPerWindow: 5, windowHours: 24 }).fails,
			),
			pass: [block()],
			fail: [requestReview({ reviewers: ["gsimone"] })],
		}),
	}),
);

function evaluator(failing: readonly string[]) {
	return (ref: string): Promise<RuleResult> =>
		Promise.resolve({
			ruleId: ref.split("@")[0] ?? ref,
			version: 1,
			status: "evaluated",
			passed: !failing.includes(ref),
			evidence: {},
			evaluatedAt: "2026-10-23T00:00:00.000Z",
		});
}

describe("gsimone's change-request-opens, written in tripwire.ts", async () => {
	const event = await fixtureEvent("change-request.opened.event");

	const cases = [
		{ failing: [], verdict: "pass", actions: ["request-review"] },
		{ failing: ["account-age@1"], verdict: "block", actions: ["block"] },
		{ failing: ["pr-rate-limit@1"], verdict: "block", actions: ["block"] },
		{
			failing: ["account-age@1", "pr-rate-limit@1"],
			verdict: "block",
			actions: ["block"],
		},
	] as const;

	for (const { failing, verdict, actions } of cases) {
		test(`failing ${failing.join(" and ") || "nothing"} gives ${verdict}`, async () => {
			const result = await executeWorkflow({
				definition: GATE,
				event,
				evaluateRuleRef: evaluator(failing),
				now: () => "2026-10-23T00:00:00.000Z",
			});
			expect(result.verdict).toBe(verdict);
			expect(result.actions.map((action) => action.action)).toEqual([
				...actions,
			]);
		});
	}
});
