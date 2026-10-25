import { describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW, type WorkflowDefinition } from "@tripwire/contracts";
import { actionUrl } from "#/lib/run-links";
import { splitStepNode, workflowOutcomes } from "#/lib/run-workflows";

const HELD: WorkflowDefinition = {
	id: "wf-solar",
	name: "solar-lighthouse",
	version: 1,
	nodes: [
		{ id: "trigger", type: "trigger", kinds: ["change-request.opened"] },
		{ id: "crypto", type: "rule", ref: "crypto-address@1", config: {} },
		{ id: "mod", type: "action", action: "send-to-moderation" },
	],
	edges: [],
};

describe("splitStepNode", () => {
	test("finds the owning workflow and drops the resume suffix", () => {
		expect(
			splitStepNode("wf-solar:mod:resume", ["default@1", "wf-solar"]),
		).toEqual({ workflowId: "wf-solar", nodeId: "mod" });
	});

	test("a bare node id belongs to the only workflow", () => {
		expect(splitStepNode("crypto", ["default@1"])).toEqual({
			workflowId: "default@1",
			nodeId: "crypto",
		});
	});

	test("run-level steps belong to no workflow", () => {
		expect(
			splitStepNode("run:degradation", ["default@1"]).workflowId,
		).toBeNull();
	});
});

describe("workflowOutcomes", () => {
	const steps = [
		{ nodeId: "default@1:crypto", nodeKind: "rule", status: "fail" },
		{ nodeId: "default@1:block", nodeKind: "action", status: "pass" },
		{ nodeId: "wf-solar:crypto", nodeKind: "rule", status: "fail" },
		{ nodeId: "wf-solar:mod", nodeKind: "action", status: "paused" },
	];

	test("block, review and the Rules name come from the snapshot", () => {
		expect(workflowOutcomes([DEFAULT_WORKFLOW, HELD], steps, "paused")).toEqual(
			[
				{ id: "default@1", name: "Rules", outcome: "block" },
				{ id: "wf-solar", name: "solar-lighthouse", outcome: "review" },
			],
		);
	});

	test("a workflow still checking has no outcome yet", () => {
		expect(workflowOutcomes([HELD], [], "running")).toEqual([
			{ id: "wf-solar", name: "solar-lighthouse", outcome: null },
		]);
	});

	test("a live workflow that could not run is listed with its own outcome", () => {
		expect(
			workflowOutcomes(
				[DEFAULT_WORKFLOW],
				[
					{
						nodeId: "run:unrunnable",
						nodeKind: "gate",
						status: "skipped",
						output: {
							workflows: [{ id: "wf-broken", name: "broken-wiring" }],
							enforced: true,
						},
					},
				],
				"paused",
			),
		).toEqual([
			{ id: "default@1", name: "Rules", outcome: "pass" },
			{ id: "wf-broken", name: "broken-wiring", outcome: "unrunnable" },
		]);
	});

	test("an unreached block passes", () => {
		expect(
			workflowOutcomes(
				[DEFAULT_WORKFLOW],
				[{ nodeId: "block", nodeKind: "action", status: "not-reached" }],
				"completed",
			)[0]?.outcome,
		).toBe("pass");
	});
});

describe("actionUrl", () => {
	const base = {
		forge: "github" as const,
		repoFullName: "acme/scratch",
		number: 91,
		externalId: "42",
	};

	test("links the check run, the review and the comment on github", () => {
		expect(actionUrl({ ...base, kind: "set-check" })).toBe(
			"https://github.com/acme/scratch/runs/42",
		);
		expect(actionUrl({ ...base, kind: "block" })).toBe(
			"https://github.com/acme/scratch/pull/91#pullrequestreview-42",
		);
		expect(actionUrl({ ...base, kind: "comment" })).toBe(
			"https://github.com/acme/scratch/pull/91#issuecomment-42",
		);
	});

	test("no link without an id, on another forge, or for other kinds", () => {
		expect(
			actionUrl({ ...base, kind: "comment", externalId: null }),
		).toBeNull();
		expect(
			actionUrl({ ...base, kind: "comment", forge: "opengit" }),
		).toBeNull();
		expect(actionUrl({ ...base, kind: "label" })).toBeNull();
	});
});

describe("workflowOutcomes with rule outcomes", () => {
	const OUTCOMES: WorkflowDefinition = {
		id: "wf-out",
		name: "outcomes",
		version: 1,
		nodes: [
			{ id: "trigger", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "age", type: "rule", ref: "account-age@1", config: {} },
			{ id: "fix", type: "action", action: "request-fix" },
			{ id: "close", type: "action", action: "close" },
		],
		edges: [],
	};

	test("a fix request reads as changes, a close on a change request as close", () => {
		expect(
			workflowOutcomes(
				[OUTCOMES],
				[
					{ nodeId: "wf-out:age", nodeKind: "rule", status: "fail" },
					{ nodeId: "wf-out:fix", nodeKind: "action", status: "pass" },
				],
				"completed",
				true,
			),
		).toEqual([{ id: "wf-out", name: "outcomes", outcome: "changes" }]);
		const closing = [
			{ nodeId: "wf-out:age", nodeKind: "rule", status: "fail" },
			{ nodeId: "wf-out:close", nodeKind: "action", status: "pass" },
		];
		expect(
			workflowOutcomes([OUTCOMES], closing, "completed", true)[0]?.outcome,
		).toBe("close");
		expect(
			workflowOutcomes([OUTCOMES], closing, "completed", false)[0]?.outcome,
		).toBe("pass");
	});
});
