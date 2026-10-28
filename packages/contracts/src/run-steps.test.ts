import { describe, expect, test } from "bun:test";
import {
	describeRunSteps,
	runSnapshotSchema,
	VERDICT_LABELS,
	verdictLabel,
} from "./run-steps.ts";
import { DEFAULT_WORKFLOW, type WorkflowDefinition } from "./workflow.ts";

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
		).toMatchObject([
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
					input: { decision: "deny", pausedNodeId: "newcomers:either" },
				},
			],
		);
		expect(resumed).toMatchObject({
			workflow: "Newcomers",
			stepId: "either",
			step: "Any of",
			gate: "any of",
			outcome: "Doesn't pass",
		});
		expect(floor).toMatchObject({
			workflow: "Newcomers",
			stepId: null,
			step: "Human review blocked it",
			outcome: "Blocked",
		});
	});

	test("a step whose workflow is not in the snapshot keeps its id", () => {
		expect(
			describeRunSteps(runSnapshotSchema.parse("not a snapshot"), [
				step("gone:x", "rule", "pass"),
			]),
		).toMatchObject([
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

	test("steps group by workflow and follow the graph after a resume", () => {
		const review: WorkflowDefinition = {
			id: "review",
			name: "Doubtful title",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "english", type: "rule", ref: "english-only@1", config: {} },
				{ id: "hold", type: "action", action: "send-to-moderation" },
				{
					id: "after",
					type: "action",
					action: "label",
					params: { labels: ["approved"] },
				},
			],
			edges: [
				{ id: "e1", from: "t", to: "english" },
				{ id: "e2", from: "english", to: "hold", when: "fail" },
				{ id: "e3", from: "hold", to: "after", when: "approve" },
			],
		};
		const views = describeRunSteps(
			[NEWCOMERS, review],
			[
				step("newcomers:t", "trigger", "pass"),
				step("review:english", "rule", "fail"),
				step("newcomers:age", "rule", "pass"),
				step("review:t", "trigger", "pass"),
				step("review:hold", "action", "paused"),
				{
					...step("review:hold:resume", "action", "pass"),
					input: { action: "send-to-moderation", decision: "approve" },
				},
				step("review:after:resume", "action", "pass"),
			],
		);
		expect(
			views.map((view) => [view.workflow, view.step, view.outcome]),
		).toEqual([
			["Newcomers", "Trigger", "Ran"],
			["Newcomers", "Account age", "Passes"],
			["Doubtful title", "Trigger", "Ran"],
			["Doubtful title", "English only", "Doesn't pass"],
			["Doubtful title", "Human review", "Approved"],
			["Doubtful title", "Label", "Ran"],
		]);
		expect(views.some((view) => view.step.includes("after review"))).toBe(
			false,
		);
	});

	test("a denied review reads Blocked once, at the review", () => {
		const review: WorkflowDefinition = {
			id: "review",
			name: "Doubtful title",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "hold", type: "action", action: "send-to-moderation" },
			],
			edges: [{ id: "e1", from: "t", to: "hold" }],
		};
		const views = describeRunSteps(
			[review, DEFAULT_WORKFLOW],
			[
				step("review:t", "trigger", "pass"),
				step("review:hold", "action", "paused"),
				step("default@1:trigger", "trigger", "pass"),
				{
					...step("run:deny-floor", "action", "pass"),
					input: { decision: "deny", pausedNodeId: "review:hold" },
				},
				{
					...step("review:hold:resume", "action", "pass"),
					input: { action: "send-to-moderation", decision: "deny" },
				},
			],
		);
		expect(
			views.map((view) => [
				view.workflow,
				view.stepId,
				view.step,
				view.outcome,
			]),
		).toEqual([
			["Doubtful title", "t", "Trigger", "Ran"],
			["Doubtful title", "hold", "Human review", "Blocked"],
			["Rules", "trigger", "Trigger", "Ran"],
		]);
	});

	test("a deny floor without a recorded decision reads after the review", () => {
		const review: WorkflowDefinition = {
			id: "review",
			name: "Doubtful title",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "hold", type: "action", action: "send-to-moderation" },
			],
			edges: [{ id: "e1", from: "t", to: "hold" }],
		};
		const views = describeRunSteps(
			[review],
			[
				step("review:t", "trigger", "pass"),
				{
					...step("run:deny-floor", "action", "pass"),
					input: { decision: "deny", pausedNodeId: "review:hold" },
				},
				step("review:hold:resume", "action", "pass"),
			],
		);
		expect(views.map((view) => [view.step, view.outcome])).toEqual([
			["Trigger", "Ran"],
			["Human review", "Ran"],
			["Human review blocked it", "Blocked"],
		]);
	});

	test("a review still waiting reads waiting", () => {
		const [row] = describeRunSteps(
			[NEWCOMERS],
			[step("newcomers:stop", "action", "paused")],
		);
		expect(row?.outcome).toBe("Waiting for human review");
	});

	test("a review on a closed run reads closed before review", () => {
		const [row] = describeRunSteps(
			[NEWCOMERS],
			[step("newcomers:stop", "action", "paused")],
			"closed",
		);
		expect(row?.outcome).toBe("Closed before review");
	});

	test("a workflow that could not run is named, with what is wrong", () => {
		const [row] = describeRunSteps(
			[NEWCOMERS],
			[
				{
					nodeId: "run:unrunnable",
					nodeKind: "gate",
					ruleId: null,
					status: "skipped",
					summary: null,
					output: {
						workflows: [{ id: "broken", name: "Crypto or honeypot" }],
						issues: [
							{
								workflowId: "broken",
								messages: ["All of: It takes rule results, not events"],
							},
						],
					},
				},
			],
		);
		expect(row).toMatchObject({
			workflow: "Crypto or honeypot",
			stepId: null,
			step: "Its wiring is broken, so Tripwire did not run it",
			outcome: "Could not run",
			summary: "All of: It takes rule results, not events",
		});
	});
});

describe("verdict words", () => {
	test("match the run page", () => {
		expect(verdictLabel("pass")).toBe("Passed");
		expect(verdictLabel("block")).toBe("Blocked");
		expect(verdictLabel("needs_review")).toBe("Waiting for human review");
		expect(Object.keys(VERDICT_LABELS)).toEqual([
			"pass",
			"block",
			"changes_required",
			"needs_review",
			"close",
		]);
	});

	test("an unknown or missing verdict has no words", () => {
		expect(verdictLabel(null)).toBeNull();
		expect(verdictLabel("maybe")).toBeNull();
	});
});
