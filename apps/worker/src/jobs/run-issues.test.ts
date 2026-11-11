import { expect, test } from "bun:test";
import {
	DEFAULT_WORKFLOW,
	type OutcomeStep,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import { resolveRunIssues } from "./run-issues.ts";

test("an approved standalone appeal removes only its own outward warning and reasons", () => {
	const standalone: WorkflowDefinition = {
		id: DEFAULT_WORKFLOW.id,
		name: "default gate",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["issue.opened"] },
			{
				id: "rule",
				type: "rule",
				ref: "account-age@1",
				config: { minDays: 30 },
			},
			{
				id: "moderation-outcome",
				type: "action",
				action: "note",
				params: { message: "A repository rule flagged this contribution." },
			},
		],
		edges: [
			{ id: "e1", from: "t", to: "rule" },
			{ id: "e2", from: "rule", to: "moderation-outcome", when: "fail" },
		],
	};
	const explicit: WorkflowDefinition = {
		...standalone,
		id: "explicit-workflow",
		nodes: standalone.nodes.map((node) =>
			node.type === "action" ? { ...node, action: "block" } : node,
		),
	};
	const steps: OutcomeStep[] = [standalone, explicit].flatMap((definition) => [
		{
			nodeId: `${definition.id}:t`,
			nodeKind: "trigger",
			status: "pass",
			input: {},
			output: {},
		},
		{
			nodeId: `${definition.id}:rule`,
			nodeKind: "rule",
			status: "fail",
			input: {},
			output: {},
		},
		{
			nodeId: `${definition.id}:moderation-outcome`,
			nodeKind: "action",
			status: "pass",
			input: {
				params: { message: "A repository rule flagged this contribution." },
			},
			output: {},
		},
	]);
	steps.push({
		nodeId: `${DEFAULT_WORKFLOW.id}:moderation-outcome:resume`,
		nodeKind: "action",
		status: "skipped",
		input: {},
		output: { waived: true, appealId: "01a16703-1a98-7568-a2a4-ac375c743b95" },
	});
	const reasons = [standalone, explicit].map((definition) => ({
		stepId: `${definition.id}:rule`,
		text: "The author did not pass this check.",
		remedy: "appeal" as const,
		ruleId: "account-age",
	}));
	const result = resolveRunIssues(
		[standalone, explicit],
		steps,
		reasons,
		false,
	);
	expect(result.standaloneOutcome).toBe(false);
	expect(result.standaloneWarning).toBe(false);
	expect(result.issues.notes).toEqual([]);
	expect(result.reasons).toEqual(reasons.slice(1));
});
