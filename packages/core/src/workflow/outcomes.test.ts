import { describe, expect, test } from "bun:test";
import {
	compileWorkflows,
	type NormalizedEvent,
	type RuleResult,
	type WorkflowDefinition,
	workflowAuthoring,
	workflowsToCode,
} from "@tripwire/contracts";
import { fixtureEvent } from "../rules/test-context.ts";
import { executeWorkflow } from "./executor.ts";

const {
	allOf,
	block,
	check,
	customCheck,
	requestFix,
	trigger,
	unless,
	workflow,
	workflows,
} = workflowAuthoring;

const on = trigger("change-request.opened", "change-request.updated");
const releasePr = allOf(
	customCheck("custom-target-release"),
	customCheck("custom-release-source"),
	customCheck("custom-release-author"),
);

const PLAN = workflows({
	target: workflow({
		on,
		check: unless(customCheck("custom-target-main"), releasePr),
		fail: [requestFix({ message: "Change the target to main." })],
	}),
	crypto: workflow({ on, check: check("crypto-address"), fail: [block()] }),
});

function compiled(): WorkflowDefinition[] {
	const result = compileWorkflows(PLAN);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.issues));
	}
	return result.definitions;
}

type Outcome = "pass" | "fail" | "skipped";

function evaluator(results: Record<string, Outcome>) {
	return (ref: string): Promise<RuleResult> => {
		const outcome = results[ref.split("@")[0] ?? ref] ?? "pass";
		return Promise.resolve({
			ruleId: ref.split("@")[0] ?? ref,
			version: 1,
			status: outcome === "skipped" ? "skipped" : "evaluated",
			passed: outcome === "pass",
			evidence: outcome === "skipped" ? null : {},
			...(outcome === "skipped" ? { reason: "not available" } : {}),
			evaluatedAt: "2026-10-25T00:00:00.000Z",
		});
	};
}

const clock = () => "2026-10-25T00:00:00.000Z";

async function runPlan(
	event: NormalizedEvent,
	results: Record<string, Outcome>,
) {
	const [target, crypto] = compiled();
	if (!(target && crypto)) {
		throw new Error("plan did not compile");
	}
	const evaluate = evaluator(results);
	const targetRun = await executeWorkflow({
		definition: target,
		event,
		evaluateRuleRef: evaluate,
		now: clock,
	});
	const cryptoRun = await executeWorkflow({
		definition: crypto,
		event,
		evaluateRuleRef: evaluate,
		now: clock,
	});
	const gate = targetRun.steps.find(
		(step) =>
			step.nodeKind === "gate" &&
			(step.input as { mode: string }).mode === "unless",
	);
	return {
		targetRun,
		cryptoRun,
		gate: gate?.output as Record<string, unknown>,
	};
}

const RELEASE = {
	"custom-target-main": "fail",
	"custom-target-release": "pass",
	"custom-release-source": "pass",
	"custom-release-author": "pass",
} as const;

describe("trycompai/crm: require main, except release PRs", async () => {
	const event = await fixtureEvent("change-request.opened.event");

	test("normal main target passes and the exception is not applied", async () => {
		const { targetRun, gate } = await runPlan(event, {
			"custom-target-main": "pass",
			"custom-target-release": "fail",
			"custom-release-source": "fail",
			"custom-release-author": "fail",
		});
		expect(targetRun.verdict).toBe("pass");
		expect(targetRun.actions).toEqual([]);
		expect(gate.exceptionApplied).toBe(false);
	});

	test("a wrong target asks the author to fix it", async () => {
		const { targetRun, gate } = await runPlan(event, {
			"custom-target-main": "fail",
			"custom-target-release": "fail",
			"custom-release-source": "fail",
			"custom-release-author": "fail",
		});
		expect(targetRun.verdict).toBe("changes_required");
		expect(targetRun.actions).toEqual([
			{
				nodeId: "request-fix",
				action: "request-fix",
				params: { message: "Change the target to main." },
			},
		]);
		expect(gate.exceptionApplied).toBe(false);
	});

	test("the complete release exception waives the target requirement", async () => {
		const { targetRun, gate } = await runPlan(event, RELEASE);
		expect(targetRun.verdict).toBe("pass");
		expect(gate).toMatchObject({
			outcome: "pass",
			requirement: "fail",
			exception: "pass",
			exceptionApplied: true,
		});
	});

	test("a spoofed source branch without the selected author does not waive it", async () => {
		const { targetRun, gate } = await runPlan(event, {
			...RELEASE,
			"custom-release-author": "fail",
		});
		expect(targetRun.verdict).toBe("changes_required");
		expect(gate.exceptionApplied).toBe(false);
	});

	test("missing exception proof keeps the requirement failed", async () => {
		const { targetRun, gate } = await runPlan(event, {
			...RELEASE,
			"custom-release-author": "skipped",
		});
		expect(targetRun.verdict).toBe("changes_required");
		expect(gate).toMatchObject({
			requirement: "fail",
			exception: "skipped",
			exceptionApplied: false,
		});
	});

	test("the release exception does not touch crypto: crypto still blocks", async () => {
		const { targetRun, cryptoRun, gate } = await runPlan(event, {
			...RELEASE,
			"crypto-address": "fail",
		});
		expect(gate.exceptionApplied).toBe(true);
		expect(targetRun.verdict).toBe("pass");
		expect(cryptoRun.verdict).toBe("block");
	});

	test("code round trip keeps the Except when gate and its named inputs", () => {
		const definitions = compiled();
		const { code, warnings } = workflowsToCode(definitions, {
			importFrom: "./.tripwire/workflow.ts",
		});
		expect(warnings).toEqual([]);
		expect(code).toContain("unless(");
		expect(code).toContain("unless(customTargetMain, allOfStep)");
		expect(code).toContain('message: "Change the target to main."');
		const target = definitions[0];
		const edges = target?.edges.filter((edge) => edge.input !== undefined);
		expect(edges?.map((edge) => edge.input)).toEqual([
			"requirement",
			"exception",
		]);
	});
});

const T = {
	id: "t",
	type: "trigger" as const,
	kinds: ["change-request.opened" as const],
};

function rule(id: string): WorkflowDefinition["nodes"][number] {
	return { id, type: "rule", ref: `${id}@1`, config: {} };
}

describe("outcome resolution", async () => {
	const event = await fixtureEvent("change-request.opened.event");

	test("join order: close > block > changes_required > needs_review > pass; notes never raise it", async () => {
		const definition: WorkflowDefinition = {
			id: "join",
			name: "join",
			version: 1,
			nodes: [
				T,
				rule("a"),
				rule("b"),
				rule("c"),
				rule("d"),
				rule("e"),
				{ id: "close", type: "action", action: "close" },
				{ id: "block", type: "action", action: "block" },
				{
					id: "fix",
					type: "action",
					action: "request-fix",
					params: { message: "Fix it." },
				},
				{ id: "review", type: "action", action: "send-to-moderation" },
				{ id: "note", type: "action", action: "note" },
			],
			edges: [
				...["a", "b", "c", "d", "e"].map((id) => ({
					id: `t-${id}`,
					from: "t",
					to: id,
				})),
				{ id: "1", from: "a", to: "close", when: "fail" as const },
				{ id: "2", from: "b", to: "block", when: "fail" as const },
				{ id: "3", from: "c", to: "fix", when: "fail" as const },
				{ id: "4", from: "d", to: "review", when: "fail" as const },
				{ id: "5", from: "e", to: "note", when: "fail" as const },
			],
		};
		const cases: [string[], string][] = [
			[["a", "b", "c", "d", "e"], "close"],
			[["b", "c", "d", "e"], "block"],
			[["c", "d", "e"], "changes_required"],
			[["d", "e"], "needs_review"],
			[["e"], "pass"],
			[[], "pass"],
		];
		for (const [failing, verdict] of cases) {
			const result = await executeWorkflow({
				definition,
				event,
				evaluateRuleRef: evaluator(
					Object.fromEntries(failing.map((id) => [id, "fail" as const])),
				),
				now: clock,
			});
			expect(result.verdict).toBe(verdict as never);
		}
	});

	test("a close action keeps today's verdict outside a change request", async () => {
		const definition: WorkflowDefinition = {
			id: "stale",
			name: "stale",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["comment.created"] },
				{ id: "close", type: "action", action: "close" },
			],
			edges: [{ id: "1", from: "t", to: "close" }],
		};
		const comment = await fixtureEvent("comment.created.event");
		const result = await executeWorkflow({
			definition,
			event: comment,
			evaluateRuleRef: evaluator({}),
			now: clock,
		});
		expect(result.actions.map((action) => action.action)).toEqual(["close"]);
		expect(result.verdict).toBe("pass");
	});

	test("an independent check keeps running while a human review waits", async () => {
		const definition: WorkflowDefinition = {
			id: "w",
			name: "w",
			version: 1,
			nodes: [
				T,
				rule("files"),
				{ id: "review", type: "action", action: "send-to-moderation" },
				{
					id: "after",
					type: "action",
					action: "label",
					params: { labels: ["ok"] },
				},
				rule("age"),
				{ id: "block", type: "action", action: "block" },
			],
			edges: [
				{ id: "1", from: "t", to: "files" },
				{ id: "2", from: "files", to: "review", when: "fail" },
				{ id: "3", from: "review", to: "after", when: "approve" },
				{ id: "4", from: "t", to: "age" },
				{ id: "5", from: "age", to: "block", when: "fail" },
			],
		};
		const first = await executeWorkflow({
			definition,
			event,
			evaluateRuleRef: evaluator({ files: "fail", age: "fail" }),
			now: clock,
		});
		expect(first.verdict).toBe("block");
		expect(first.pausedAtNodeIds).toEqual(["review"]);
		expect(first.actions.map((action) => action.action)).toEqual(["block"]);
		expect(first.steps.some((step) => step.nodeId === "age")).toBe(true);
		expect(first.steps.some((step) => step.nodeId === "after")).toBe(false);

		const resumed = await executeWorkflow({
			definition,
			event,
			evaluateRuleRef: () => Promise.reject(new Error("no re-evaluation")),
			now: clock,
			resume: {
				outcomes: first.outcomes,
				nodeId: "review",
				decision: "approve",
			},
		});
		expect(resumed.actions.map((action) => action.action)).toEqual(["label"]);
		expect(resumed.pausedAtNodeIds).toEqual([]);
	});

	test("approving one of two reviews leaves the other one waiting", async () => {
		const definition: WorkflowDefinition = {
			id: "two",
			name: "two",
			version: 1,
			nodes: [
				T,
				rule("a"),
				rule("b"),
				{ id: "ra", type: "action", action: "send-to-moderation" },
				{ id: "rb", type: "action", action: "send-to-moderation" },
				{
					id: "la",
					type: "action",
					action: "label",
					params: { labels: ["a"] },
				},
				{
					id: "lb",
					type: "action",
					action: "label",
					params: { labels: ["b"] },
				},
			],
			edges: [
				{ id: "1", from: "t", to: "a" },
				{ id: "2", from: "t", to: "b" },
				{ id: "3", from: "a", to: "ra", when: "fail" },
				{ id: "4", from: "b", to: "rb", when: "fail" },
				{ id: "5", from: "ra", to: "la", when: "approve" },
				{ id: "6", from: "rb", to: "lb", when: "approve" },
			],
		};
		const first = await executeWorkflow({
			definition,
			event,
			evaluateRuleRef: evaluator({ a: "fail", b: "fail" }),
			now: clock,
		});
		expect(first.pausedAtNodeIds).toEqual(["ra", "rb"]);
		const resumed = await executeWorkflow({
			definition,
			event,
			evaluateRuleRef: evaluator({}),
			now: clock,
			resume: { outcomes: first.outcomes, nodeId: "ra", decision: "approve" },
		});
		expect(resumed.actions.map((action) => action.params)).toEqual([
			{ labels: ["a"] },
		]);
		expect(resumed.pausedAtNodeIds).toEqual(["rb"]);
		expect(resumed.verdict).toBe("needs_review");
	});
});
