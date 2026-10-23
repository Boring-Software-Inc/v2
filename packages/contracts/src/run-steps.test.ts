import { describe, expect, test } from "bun:test";
import { describeRunSteps } from "./run-steps.ts";
import type { WorkflowDefinition } from "./workflow.ts";

const NEWCOMERS: WorkflowDefinition = {
	id: "newcomers",
	name: "Newcomers",
	version: 2,
	nodes: [
		{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
		{ id: "age", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
		{ id: "age-2", type: "rule", ref: "account-age@1", config: null },
		{ id: "either", type: "gate", mode: "any-of" },
		{ id: "stop", type: "action", action: "block" },
	],
	edges: [],
};

function step(nodeId: string, nodeKind: string, status: string) {
	return { nodeId, nodeKind, ruleId: null, status, summary: null };
}

describe("run steps read without the code", () => {
	test("each step names its workflow, title, id, gate mode and outcome", () => {
		expect(
			describeRunSteps(
				[NEWCOMERS],
				[
					step("newcomers:t", "trigger", "pass"),
					step("newcomers:age", "rule", "fail"),
					step("newcomers:age-2", "rule", "skipped"),
					step("newcomers:either", "gate", "pass"),
					step("newcomers:stop", "action", "pass"),
				],
			),
		).toEqual([
			{
				workflow: "Newcomers",
				stepId: "t",
				step: "Trigger",
				gate: null,
				outcome: "Ran",
				summary: null,
			},
			{
				workflow: "Newcomers",
				stepId: "age",
				step: "Account age",
				gate: null,
				outcome: "Doesn't pass",
				summary: null,
			},
			{
				workflow: "Newcomers",
				stepId: "age-2",
				step: "Account age 2",
				gate: null,
				outcome: "Could not run",
				summary: null,
			},
			{
				workflow: "Newcomers",
				stepId: "either",
				step: "Any of",
				gate: "any of",
				outcome: "Passes",
				summary: null,
			},
			{
				workflow: "Newcomers",
				stepId: "stop",
				step: "Block",
				gate: null,
				outcome: "Ran",
				summary: null,
			},
		]);
	});

	test("a resumed step and a run-level step still read", () => {
		const [resumed, floor] = describeRunSteps(
			[NEWCOMERS],
			[
				step("newcomers:either:resume", "gate", "fail"),
				{
					nodeId: "run:deny-floor",
					nodeKind: "action",
					ruleId: null,
					status: "pass",
					summary: null,
				},
			],
		);
		expect(resumed).toMatchObject({
			workflow: "Newcomers",
			stepId: "either",
			step: "Any of (after review)",
			gate: "any of",
			outcome: "Doesn't pass",
		});
		expect(floor).toMatchObject({
			workflow: null,
			stepId: "run:deny-floor",
			step: "Human review blocked it",
			outcome: "Ran",
		});
	});

	test("a step whose workflow is not in the snapshot keeps its id", () => {
		expect(
			describeRunSteps("not a snapshot", [step("gone:x", "rule", "pass")]),
		).toEqual([
			{
				workflow: null,
				stepId: "gone:x",
				step: "gone:x",
				gate: null,
				outcome: "Passes",
				summary: null,
			},
		]);
	});
});
