import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@tripwire/contracts";
import {
	mergeLiveSteps,
	pendingRuleStepsFromSnapshot,
} from "#/lib/run-live-steps";
import type { RunStepView } from "#/lib/runs.functions";

const SNAPSHOT: WorkflowDefinition[] = [
	{
		id: "default@1",
		name: "default gate",
		version: 1,
		nodes: [
			{
				id: "trigger",
				type: "trigger",
				kinds: ["change-request.opened"],
			},
			{
				id: "rule-0",
				type: "rule",
				ref: "account-age@1",
				config: { minDays: 7 },
			},
			{
				id: "rule-1",
				type: "rule",
				ref: "honeypot@1",
				config: { paths: [".github/workflows/**"] },
			},
			{ id: "gate", type: "gate", mode: "all-of" },
		],
		edges: [],
	},
];

const done: RunStepView = {
	id: "s1",
	nodeId: "default@1:rule-0",
	nodeKind: "rule",
	ruleRef: "account-age@1",
	status: "pass",
	evidence: null,
	output: null,
	durationMs: 1,
	startedAt: "2026-07-20T00:00:00.000Z",
	publicEvidence: null,
	summary: "old enough",
};

describe("pendingRuleStepsFromSnapshot", () => {
	test("lists unfinished rule nodes only", () => {
		const pending = pendingRuleStepsFromSnapshot(SNAPSHOT, [done]);
		expect(pending.map((p) => p.ruleRef)).toEqual(["honeypot@1"]);
		expect(pending[0]?.status).toBe("pending");
	});

	test("empty when every rule finished", () => {
		const both = [
			done,
			{
				...done,
				id: "s2",
				nodeId: "default@1:rule-1",
				ruleRef: "honeypot@1",
			},
		];
		expect(pendingRuleStepsFromSnapshot(SNAPSHOT, both)).toEqual([]);
	});
});

describe("mergeLiveSteps", () => {
	test("appends pending only while evaluating", () => {
		const live = mergeLiveSteps("running", SNAPSHOT, [done]);
		expect(live).toHaveLength(2);
		expect(live[1]?.status).toBe("pending");
		expect(mergeLiveSteps("completed", SNAPSHOT, [done])).toEqual([done]);
	});
});
