import { describe, expect, test } from "bun:test";
import {
	DEFAULT_WORKFLOW,
	describeRunSteps,
	type NormalizedEvent,
	normalizedEventSchema,
	type RuleResult,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import { executeWorkflow, type StepRecord } from "@tripwire/core";
import { resumedSteps } from "./resume-run.ts";

const REVIEW: WorkflowDefinition = {
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

async function openedEvent(): Promise<NormalizedEvent> {
	return normalizedEventSchema.parse(
		await Bun.file(
			new URL(
				"../../../../packages/core/fixtures/change-request.opened.event.json",
				import.meta.url,
			).pathname,
		).json(),
	);
}

const failing = (ref: string): Promise<RuleResult> =>
	Promise.resolve({
		ruleId: ref.split("@")[0] as string,
		version: 1,
		status: "evaluated",
		passed: false,
		evidence: {},
		evaluatedAt: "2026-10-23T00:00:00.000Z",
	});

const now = () => "2026-10-23T00:00:00.000Z";

function stored(steps: readonly StepRecord[]) {
	return steps.map((step) => ({
		nodeId: step.nodeId,
		nodeKind: step.nodeKind,
		ruleId: step.ruleRef ?? null,
		status: step.status,
		summary: null,
		input: step.input,
		output: step.output,
	}));
}

async function decidedRun(decision: "approve" | "deny") {
	const event = await openedEvent();
	const first = await executeWorkflow({
		definition: REVIEW,
		event,
		evaluateRuleRef: failing,
		now,
	});
	expect(first.pausedAtNodeId).toBe("hold");
	const second = await executeWorkflow({
		definition: REVIEW,
		event,
		evaluateRuleRef: failing,
		now,
		resume: {
			outcomes: first.outcomes,
			nodeId: "hold",
			decision,
		},
	});
	const before = first.steps.map((step) => ({
		...step,
		nodeId: `${REVIEW.id}:${step.nodeId}`,
	}));
	const after = resumedSteps(
		REVIEW.id,
		second.steps,
		decision === "deny" ? "review:hold" : null,
		now(),
	);
	return describeRunSteps(
		[REVIEW, DEFAULT_WORKFLOW],
		stored([...before, ...after]),
	);
}

describe("a resumed human review, as the executor records it", () => {
	test("approve reads Approved, once", async () => {
		const views = await decidedRun("approve");
		const review = views.filter((view) => view.step === "Human review");
		expect(review.map((view) => view.outcome)).toEqual(["Approved"]);
		expect(views.map((view) => [view.step, view.outcome])).toEqual([
			["Trigger", "Ran"],
			["English only", "Doesn't pass"],
			["Human review", "Approved"],
			["Label", "Ran"],
		]);
	});

	test("deny reads Blocked, once, at the review", async () => {
		const views = await decidedRun("deny");
		expect(
			views.map((view) => [
				view.workflow,
				view.stepId,
				view.step,
				view.outcome,
			]),
		).toEqual([
			["Doubtful title", "t", "Trigger", "Ran"],
			["Doubtful title", "english", "English only", "Doesn't pass"],
			["Doubtful title", "hold", "Human review", "Blocked"],
		]);
	});
});
