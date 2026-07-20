import { describe, expect, test } from "bun:test";
import type { RuleResult, WorkflowDefinition } from "@tripwire/contracts";
import { fixtureEvent } from "../rules/test-context.ts";
import { executeWorkflow, type NodeOutcome } from "./executor.ts";
import { validateWorkflow } from "./validate.ts";

/** A gate workflow: two rules → all-of → block on fail. */
const GATED: WorkflowDefinition = {
	id: "wf-default",
	name: "default",
	version: 1,
	nodes: [
		{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
		{ id: "r1", type: "rule", ref: "account-age@1", config: { minDays: 30 } },
		{ id: "r2", type: "rule", ref: "crypto-address@1", config: {} },
		{ id: "g", type: "gate", mode: "all-of" },
		{ id: "block", type: "action", action: "block" },
	],
	edges: [
		{ id: "e1", from: "t", to: "r1" },
		{ id: "e2", from: "t", to: "r2" },
		{ id: "e3", from: "r1", to: "g" },
		{ id: "e4", from: "r2", to: "g" },
		{ id: "e5", from: "g", to: "block", when: "fail" },
	],
};

const MODERATED: WorkflowDefinition = {
	id: "wf-mod",
	name: "moderated",
	version: 1,
	nodes: [
		{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
		{ id: "r1", type: "rule", ref: "account-age@1", config: { minDays: 30 } },
		{ id: "mod", type: "action", action: "send-to-moderation" },
		{ id: "block", type: "action", action: "block" },
		{
			id: "label",
			type: "action",
			action: "label",
			params: { labels: ["ok"] },
		},
	],
	edges: [
		{ id: "e1", from: "t", to: "r1" },
		{ id: "e2", from: "r1", to: "mod", when: "fail" },
		{ id: "e3", from: "mod", to: "block", when: "deny" },
		{ id: "e4", from: "mod", to: "label", when: "approve" },
	],
};

function fakeEvaluator(results: Record<string, Partial<RuleResult>>) {
	return (ref: string): Promise<RuleResult> => {
		const overlay = results[ref] ?? {};
		return Promise.resolve({
			ruleId: ref.split("@")[0] as string,
			version: 1,
			status: "evaluated",
			passed: true,
			evidence: {},
			evaluatedAt: "2026-07-11T00:00:00.000Z",
			...overlay,
		});
	};
}

let tick = 0;
const clock = () => new Date(1_752_000_000_000 + tick++ * 10).toISOString();

describe("executeWorkflow", () => {
	test("onStep fires once per recorded step in order", async () => {
		const seen: string[] = [];
		await executeWorkflow({
			definition: GATED,
			event: await fixtureEvent("change-request.opened.event"),
			evaluateRuleRef: fakeEvaluator({}),
			now: clock,
			onStep: (step) => {
				seen.push(step.nodeId);
			},
		});
		expect(seen).toEqual(["t", "r1", "r2", "g"]);
	});

	test("all rules pass ⇒ verdict pass, block never conducts", async () => {
		const result = await executeWorkflow({
			definition: GATED,
			event: await fixtureEvent("change-request.opened.event"),
			evaluateRuleRef: fakeEvaluator({}),
			now: clock,
		});
		expect(result.verdict).toBe("pass");
		expect(result.actions).toEqual([]);
		expect(result.steps.map((s) => s.nodeId)).toEqual(["t", "r1", "r2", "g"]);
	});

	test("failing rule ⇒ gate fails ⇒ block conducts ⇒ verdict block", async () => {
		const result = await executeWorkflow({
			definition: GATED,
			event: await fixtureEvent("change-request.opened.event"),
			evaluateRuleRef: fakeEvaluator({
				"account-age@1": { passed: false },
			}),
			now: clock,
		});
		expect(result.verdict).toBe("block");
		expect(result.actions).toEqual([
			{ nodeId: "block", action: "block", params: {} },
		]);
		const gateStep = result.steps.find((s) => s.nodeId === "g");
		expect(gateStep?.status).toBe("fail");
	});

	test("single failing rule → all-of gate → block (live-test surprise #2)", async () => {
		// trigger → ONE rule → all-of gate → block. The failing lone rule's
		// pass-edge never conducts; the gate must still run and fail.
		const single: WorkflowDefinition = {
			id: "wf-single",
			name: "single",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				{ id: "r1", type: "rule", ref: "account-age@1", config: {} },
				{ id: "g", type: "gate", mode: "all-of" },
				{ id: "block", type: "action", action: "block" },
			],
			edges: [
				{ id: "e1", from: "t", to: "r1" },
				{ id: "e2", from: "r1", to: "g" },
				{ id: "e3", from: "g", to: "block", when: "fail" },
			],
		};
		const result = await executeWorkflow({
			definition: single,
			event: await fixtureEvent("change-request.opened.event"),
			evaluateRuleRef: fakeEvaluator({ "account-age@1": { passed: false } }),
			now: clock,
		});
		expect(result.verdict).toBe("block");
		expect(result.actions.map((a) => a.action)).toEqual(["block"]);
	});

	test("ALL rules fail ⇒ gate fails ⇒ block (the hole, closed)", async () => {
		const result = await executeWorkflow({
			definition: GATED,
			event: await fixtureEvent("change-request.opened.event"),
			evaluateRuleRef: fakeEvaluator({
				"account-age@1": { passed: false },
				"crypto-address@1": { passed: false },
			}),
			now: clock,
		});
		expect(result.verdict).toBe("block");
		const gateStep = result.steps.find((s) => s.nodeId === "g");
		expect(gateStep?.status).toBe("fail");
	});

	test("property: derived shape with ≥1 failing rule never verdicts pass", async () => {
		// Exhaustive over all 2^N pass/fail combinations of a derived-shape
		// workflow (trigger → N rules → all-of gate → block on fail). No
		// combination with a failing rule may yield pass; all-pass yields pass.
		const N = 5;
		const refs = Array.from({ length: N }, (_, i) => `account-age@${i + 1}`);
		const derived: WorkflowDefinition = {
			id: "wf-derived",
			name: "derived",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				...refs.map((ref, i) => ({
					id: `r${i}`,
					type: "rule" as const,
					ref,
					config: {},
				})),
				{ id: "g", type: "gate", mode: "all-of" as const },
				{ id: "block", type: "action", action: "block" as const },
			],
			edges: [
				...refs.map((_ref, i) => ({ id: `t${i}`, from: "t", to: `r${i}` })),
				...refs.map((_ref, i) => ({ id: `g${i}`, from: `r${i}`, to: "g" })),
				{ id: "eb", from: "g", to: "block", when: "fail" as const },
			],
		};
		const event = await fixtureEvent("change-request.opened.event");
		for (let mask = 0; mask < 1 << N; mask++) {
			const passing = refs.map((_ref, i) => (mask & (1 << i)) !== 0);
			const overlay: Record<string, Partial<RuleResult>> = {};
			refs.forEach((ref, i) => {
				overlay[ref] = { passed: passing[i] };
			});
			const result = await executeWorkflow({
				definition: derived,
				event,
				evaluateRuleRef: fakeEvaluator(overlay),
				now: clock,
			});
			if (passing.every(Boolean)) {
				expect(result.verdict).toBe("pass");
			} else {
				expect(result.verdict).toBe("block");
			}
		}
	});

	test("skipped rule conducts as pass but records skipped (§6)", async () => {
		const result = await executeWorkflow({
			definition: GATED,
			event: await fixtureEvent("change-request.opened.event"),
			evaluateRuleRef: fakeEvaluator({
				"account-age@1": {
					status: "skipped",
					passed: false,
					reason: "contributor profile unavailable",
				},
			}),
			now: clock,
		});
		expect(result.verdict).toBe("pass");
		const step = result.steps.find((s) => s.nodeId === "r1");
		expect(step?.status).toBe("skipped");
	});

	test("disabled rule records `disabled`, conducts as pass, is not evaluated (§6 kill switch)", async () => {
		let evaluated = 0;
		const result = await executeWorkflow({
			definition: GATED,
			event: await fixtureEvent("change-request.opened.event"),
			evaluateRuleRef: (ref) => {
				evaluated++;
				return fakeEvaluator({})(ref);
			},
			isRuleDisabled: (ref) => ref === "account-age@1",
			now: clock,
		});
		expect(result.verdict).toBe("pass");
		const step = result.steps.find((s) => s.nodeId === "r1");
		expect(step?.status).toBe("disabled");
		// only r2 was evaluated; the disabled r1 never called the evaluator.
		expect(evaluated).toBe(1);
	});

	test("non-matching trigger ⇒ nothing runs", async () => {
		const result = await executeWorkflow({
			definition: GATED,
			event: await fixtureEvent("comment.created.event"),
			evaluateRuleRef: fakeEvaluator({}),
			now: clock,
		});
		expect(result.steps).toEqual([]);
		expect(result.verdict).toBe("pass");
	});

	test("send-to-moderation pauses ⇒ needs_review; resume walks the decision edge", async () => {
		const event = await fixtureEvent("change-request.opened.event");
		const paused = await executeWorkflow({
			definition: MODERATED,
			event,
			evaluateRuleRef: fakeEvaluator({
				"account-age@1": { passed: false },
			}),
			now: clock,
		});
		expect(paused.verdict).toBe("needs_review");
		expect(paused.pausedAtNodeId).toBe("mod");
		expect(paused.actions).toEqual([]);

		const denied = await executeWorkflow({
			definition: MODERATED,
			event,
			evaluateRuleRef: fakeEvaluator({}),
			now: clock,
			resume: {
				outcomes: paused.outcomes as Record<string, NodeOutcome>,
				nodeId: "mod",
				decision: "deny",
			},
		});
		expect(denied.verdict).toBe("block");
		expect(denied.actions.map((a) => a.action)).toEqual(["block"]);

		const approved = await executeWorkflow({
			definition: MODERATED,
			event,
			evaluateRuleRef: fakeEvaluator({}),
			now: clock,
			resume: {
				outcomes: paused.outcomes as Record<string, NodeOutcome>,
				nodeId: "mod",
				decision: "approve",
			},
		});
		expect(approved.verdict).toBe("pass");
		expect(approved.actions.map((a) => a.action)).toEqual(["label"]);
	});

	test("steps carry timings and rule evidence", async () => {
		const result = await executeWorkflow({
			definition: GATED,
			event: await fixtureEvent("change-request.opened.event"),
			evaluateRuleRef: fakeEvaluator({}),
			now: clock,
		});
		const ruleStep = result.steps.find((s) => s.nodeId === "r1");
		expect(ruleStep?.ruleRef).toBe("account-age@1");
		expect((ruleStep?.output as RuleResult).ruleId).toBe("account-age");
		expect(ruleStep?.durationMs).toBeGreaterThanOrEqual(0);
	});
});

describe("validateWorkflow", () => {
	test("accepts the gated workflow", () => {
		expect(validateWorkflow(GATED).valid).toBe(true);
	});

	test("rejects cycles", () => {
		const cyclic = {
			...GATED,
			edges: [...GATED.edges, { id: "back", from: "g", to: "r1" }],
		};
		const result = validateWorkflow(cyclic);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.issues.some((i) => i.message.includes("cycle"))).toBe(true);
		}
	});

	test("rejects unreachable nodes, bad refs, and misplaced approve edges", () => {
		const bad = {
			id: "w",
			name: "w",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["push"] },
				{ id: "orphan", type: "gate", mode: "all-of" },
				{ id: "r", type: "rule", ref: "NotKebab@1", config: {} },
			],
			edges: [{ id: "e", from: "t", to: "missing", when: "approve" }],
		};
		const result = validateWorkflow(bad);
		expect(result.valid).toBe(false);
	});
});
