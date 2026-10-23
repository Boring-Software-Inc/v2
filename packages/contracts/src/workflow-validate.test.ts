import { describe, expect, test } from "bun:test";
import { customValidationEntries } from "./custom-rules.ts";
import { RULE_CATALOG } from "./rules.ts";
import {
	ACTION_CATALOG,
	DEFAULT_WORKFLOW,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "./workflow.ts";
import {
	validateWorkflow,
	validateWorkflowForEnable,
} from "./workflow-validate.ts";

function graph(over: Partial<WorkflowDefinition>): WorkflowDefinition {
	return {
		id: "w",
		name: "w",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
			{ id: "a", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "a", when: "fail" },
		],
		...over,
	};
}

function issuesOf(result: ReturnType<typeof validateWorkflow>): string[] {
	return result.valid ? [] : result.issues.map((i) => i.message);
}

function rulesOf(result: ReturnType<typeof validateWorkflow>): string[] {
	return result.valid ? [] : result.issues.map((i) => i.rule);
}

describe("validateWorkflow (base — every failure class)", () => {
	test("valid graph and DEFAULT_WORKFLOW pass", () => {
		expect(validateWorkflow(graph({})).valid).toBe(true);
		expect(validateWorkflow(DEFAULT_WORKFLOW).valid).toBe(true);
	});

	test("schema shape failure", () => {
		expect(validateWorkflow({ nope: true }).valid).toBe(false);
	});

	test("duplicate node id", () => {
		const g = graph({});
		g.nodes.push({ id: "t", type: "gate", mode: "all-of" });
		g.edges.push({ id: "e3", from: "r", to: "t" });
		expect(rulesOf(validateWorkflow(g))).toContain("duplicate-id");
	});

	test("duplicate edge id", () => {
		const g = graph({});
		g.edges.push({ id: "e1", from: "t", to: "a" });
		expect(rulesOf(validateWorkflow(g))).toContain("duplicate-id");
	});

	test("edge references a missing node", () => {
		const g = graph({});
		g.edges.push({ id: "e3", from: "ghost", to: "a" });
		expect(rulesOf(validateWorkflow(g))).toContain("missing-step");
	});

	test("no trigger", () => {
		const g = graph({});
		g.nodes = g.nodes.filter((n) => n.type !== "trigger");
		g.edges = g.edges.filter((e) => e.from !== "t");
		expect(rulesOf(validateWorkflow(g))).toContain("no-trigger");
	});

	test("trigger with inputs", () => {
		const g = graph({});
		g.edges.push({ id: "e3", from: "r", to: "t" });
		expect(rulesOf(validateWorkflow(g))).toContain("trigger-input");
	});

	test("`not` gate arity", () => {
		const g = graph({});
		g.nodes.push({ id: "g", type: "gate", mode: "not" });
		g.edges.push(
			{ id: "e3", from: "t", to: "g" },
			{ id: "e4", from: "r", to: "g" },
		);
		expect(rulesOf(validateWorkflow(g))).toContain("not-input");
	});

	test("unreachable node", () => {
		const g = graph({});
		g.nodes.push({ id: "orphan", type: "gate", mode: "all-of" });
		expect(rulesOf(validateWorkflow(g))).toContain("orphan-step");
	});

	test("approve/deny edges only leave send-to-moderation", () => {
		const g = graph({});
		g.edges[1] = { id: "e2", from: "r", to: "a", when: "approve" };
		expect(rulesOf(validateWorkflow(g))).toContain("wrong-output");
	});

	test("non-moderation actions cannot have outputs", () => {
		const g = graph({});
		g.nodes.push({ id: "g", type: "gate", mode: "all-of" });
		g.edges.push({ id: "e3", from: "a", to: "g" });
		expect(rulesOf(validateWorkflow(g))).toContain("no-outputs");
	});

	test("trigger straight into a gate breaks the connection matrix", () => {
		const g = graph({});
		g.nodes.push({ id: "g", type: "gate", mode: "all-of" });
		g.edges.push({ id: "e3", from: "t", to: "g" });
		const result = validateWorkflow(g);
		expect(result.valid).toBe(false);
		expect(result.valid ? [] : result.issues).toContainEqual({
			rule: "gate-input",
			severity: "error",
			step: "All of",
			edgeId: "e3",
			nodeId: "g",
			message: "It takes rule results, not events.",
			fixes: [
				{
					label: "Insert a rule",
					intent: { type: "insert-step", edgeId: "e3" },
				},
				{
					label: "Remove connection",
					edit: { type: "remove-edge", edgeId: "e3" },
				},
			],
		});
	});

	test("a gate fed from a doesn't-pass output breaks the connection matrix", () => {
		const g = graph({});
		g.nodes.push({ id: "g", type: "gate", mode: "any-of" });
		g.edges.push({ id: "e3", from: "r", to: "g", when: "fail" });
		expect(issuesOf(validateWorkflow(g))).toContain("It takes only Passes.");
	});

	test("branching paths and several triggers stay valid", () => {
		const g = graph({});
		g.nodes.push(
			{ id: "t2", type: "trigger", kinds: ["comment.created"] },
			{ id: "c", type: "action", action: "comment" },
		);
		g.edges.push(
			{ id: "e3", from: "r", to: "c" },
			{ id: "e4", from: "t2", to: "c" },
		);
		expect(validateWorkflow(g).valid).toBe(true);
	});

	test("cycle detection", () => {
		const g = graph({});
		g.nodes.push({ id: "g", type: "gate", mode: "all-of" });
		g.edges.push(
			{ id: "e3", from: "r", to: "g" },
			{ id: "e4", from: "g", to: "r" },
		);
		expect(rulesOf(validateWorkflow(g))).toContain("cycle");
	});
});

describe("validateWorkflowForEnable (the two enable-time invariants)", () => {
	test("valid graph enables", () => {
		expect(validateWorkflowForEnable(graph({})).valid).toBe(true);
	});

	test("no action reachable from a trigger", () => {
		// trigger→rule only; the action hangs off nothing (still structurally
		// valid is impossible — give it an input from a second trigger-less…
		// simplest honest shape: no action node at all).
		const g = graph({});
		g.nodes = g.nodes.filter((n) => n.id !== "a");
		g.edges = g.edges.filter((e) => e.to !== "a");
		const result = validateWorkflowForEnable(g);
		expect(rulesOf(result)).toContain("no-action");
	});

	test("unknown rule ref refuses at enable (frozen snapshots still pass BASE)", () => {
		const g = graph({});
		const rule = g.nodes.find((n) => n.type === "rule");
		if (rule?.type === "rule") {
			rule.ref = "ai-review@1"; // frozen: absent from RULE_CATALOG
			rule.config = {};
		}
		expect(validateWorkflow(g).valid).toBe(true); // base: structural only
		expect(rulesOf(validateWorkflowForEnable(g))).toContain("unknown-rule");
	});

	test("rule config must parse against its catalog schema", () => {
		const g = graph({});
		const rule = g.nodes.find((n) => n.type === "rule");
		if (rule?.type === "rule") {
			rule.config = { minDays: -1 };
		}
		expect(validateWorkflow(g).valid).toBe(true);
		expect(validateWorkflowForEnable(g).valid).toBe(false);
	});
});

describe("validateWorkflowForEnable — custom rules via the runtime catalog", () => {
	const customGraph = graph({
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: "custom-irrelevant-019f93@1", config: {} },
			{ id: "a", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "a", when: "fail" },
		],
	});
	const custom = [{ ref: "custom-irrelevant-019f93@1", name: "irrelevant" }];

	test("built-ins alone read a custom ref as 'unknown rule' (the editor bug)", () => {
		expect(issuesOf(validateWorkflowForEnable(customGraph))).toContain(
			"This rule is not in this repo.",
		);
	});

	test("merging customValidationEntries lets the custom rule enable", () => {
		const catalog = [...RULE_CATALOG, ...customValidationEntries(custom)];
		expect(validateWorkflowForEnable(customGraph, catalog).valid).toBe(true);
	});
});

describe("the removed comment step", () => {
	const withComment = graph({
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
			{ id: "c", type: "action", action: "comment" },
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "c" },
		],
	});

	test("a stored workflow with one still parses", () => {
		expect(validateWorkflow(withComment).valid).toBe(true);
	});

	test("it cannot be enabled until the step is deleted", () => {
		expect(rulesOf(validateWorkflowForEnable(withComment))).toEqual([
			"removed-step",
		]);
	});
});

describe("the removed discord step", () => {
	const withDiscord = graph({
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "r", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
			{ id: "b", type: "action", action: "block" },
			{
				id: "d",
				type: "action",
				action: "discord",
				params: { url: "https://discord.com/api/webhooks/1/abc" },
			},
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "b", when: "fail" },
			{ id: "e3", from: "r", to: "d", when: "fail" },
		],
	});

	test("a stored workflow with one still parses", () => {
		expect(workflowDefinitionSchema.safeParse(withDiscord).success).toBe(true);
		expect(validateWorkflow(withDiscord).valid).toBe(true);
	});

	test("it cannot be enabled until the step is deleted", () => {
		expect(rulesOf(validateWorkflowForEnable(withDiscord))).toEqual([
			"removed-step",
		]);
	});

	test("the toolbox no longer offers it", () => {
		expect(ACTION_CATALOG.map((entry) => entry.action)).not.toContain(
			"discord",
		);
	});
});
