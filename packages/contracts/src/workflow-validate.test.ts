import { describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW, type WorkflowDefinition } from "./workflow.ts";
import {
	validateWorkflow,
	validateWorkflowForEnable,
} from "./workflow-validate.ts";

/**
 * One test per failure class (§editor rebuild). The base validator moved here
 * from core UNCHANGED (core's suite still exercises it through the re-export);
 * these pin every invariant at its new home plus the two enable-time ones.
 */

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
		expect(issuesOf(validateWorkflow(g))).toContain("duplicate node id");
	});

	test("duplicate edge id", () => {
		const g = graph({});
		g.edges.push({ id: "e1", from: "t", to: "a" });
		expect(issuesOf(validateWorkflow(g))).toContain("duplicate edge id");
	});

	test("edge references a missing node", () => {
		const g = graph({});
		g.edges.push({ id: "e3", from: "ghost", to: "a" });
		expect(
			issuesOf(validateWorkflow(g)).some((m) => m.includes("unknown source")),
		).toBe(true);
	});

	test("no trigger", () => {
		const g = graph({});
		g.nodes = g.nodes.filter((n) => n.type !== "trigger");
		g.edges = g.edges.filter((e) => e.from !== "t");
		expect(
			issuesOf(validateWorkflow(g)).some((m) =>
				m.includes("at least one trigger"),
			),
		).toBe(true);
	});

	test("trigger with inputs", () => {
		const g = graph({});
		g.edges.push({ id: "e3", from: "r", to: "t" });
		expect(issuesOf(validateWorkflow(g))).toContain(
			"trigger cannot have inputs",
		);
	});

	test("`not` gate arity", () => {
		const g = graph({});
		g.nodes.push({ id: "g", type: "gate", mode: "not" });
		g.edges.push(
			{ id: "e3", from: "t", to: "g" },
			{ id: "e4", from: "r", to: "g" },
		);
		expect(issuesOf(validateWorkflow(g))).toContain(
			"`not` gate takes exactly one input",
		);
	});

	test("unreachable node", () => {
		const g = graph({});
		g.nodes.push({ id: "orphan", type: "gate", mode: "all-of" });
		expect(issuesOf(validateWorkflow(g))).toContain("unreachable node");
	});

	test("approve/deny edges only leave send-to-moderation", () => {
		const g = graph({});
		g.edges[1] = { id: "e2", from: "r", to: "a", when: "approve" };
		expect(
			issuesOf(validateWorkflow(g)).some((m) =>
				m.includes("send-to-moderation"),
			),
		).toBe(true);
	});

	test("non-moderation actions cannot have outputs", () => {
		const g = graph({});
		g.nodes.push({ id: "g", type: "gate", mode: "all-of" });
		g.edges.push({ id: "e3", from: "a", to: "g" });
		expect(
			issuesOf(validateWorkflow(g)).some((m) => m.includes("may have outputs")),
		).toBe(true);
	});

	test("cycle detection", () => {
		const g = graph({});
		g.nodes.push({ id: "g", type: "gate", mode: "all-of" });
		g.edges.push(
			{ id: "e3", from: "r", to: "g" },
			{ id: "e4", from: "g", to: "r" },
		);
		expect(issuesOf(validateWorkflow(g))).toContain(
			"workflow contains a cycle",
		);
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
		expect(
			issuesOf(result).some((m) => m.includes("no action is reachable")),
		).toBe(true);
	});

	test("unknown rule ref refuses at enable (frozen snapshots still pass BASE)", () => {
		const g = graph({});
		const rule = g.nodes.find((n) => n.type === "rule");
		if (rule?.type === "rule") {
			rule.ref = "ai-review@1"; // frozen: absent from RULE_CATALOG
			rule.config = {};
		}
		expect(validateWorkflow(g).valid).toBe(true); // base: structural only
		expect(
			issuesOf(validateWorkflowForEnable(g)).some((m) =>
				m.includes("unknown rule"),
			),
		).toBe(true);
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
