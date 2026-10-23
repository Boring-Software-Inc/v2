import { describe, expect, test } from "bun:test";
import { customValidationEntries } from "./custom-rules.ts";
import { RULE_CATALOG } from "./rules.ts";
import {
	DEFAULT_WORKFLOW,
	type JsonValue,
	type WorkflowDefinition,
	type WorkflowEdge,
	type WorkflowNode,
} from "./workflow.ts";
import {
	applyLintEdit,
	insertStep,
	LINT_RULES,
	type LintEdit,
	type LintResult,
	type LintRuleId,
	lintWorkflow,
	openPosition,
	outputHint,
	portHint,
	stepDisplayName,
} from "./workflow-lint.ts";
import { validateWorkflowForEnable } from "./workflow-validate.ts";

const TRIGGER: WorkflowNode = {
	id: "t",
	type: "trigger",
	kinds: ["change-request.opened"],
	position: { x: 0, y: 0 },
};
const RULE: WorkflowNode = {
	id: "r",
	type: "rule",
	ref: "account-age@1",
	config: { minDays: 7 },
	position: { x: 300, y: 0 },
};
const GATE: WorkflowNode = {
	id: "g",
	type: "gate",
	mode: "all-of",
	position: { x: 600, y: 0 },
};
const BLOCK: WorkflowNode = {
	id: "a",
	type: "action",
	action: "block",
	position: { x: 900, y: 0 },
};

function graph(
	nodes: WorkflowNode[] = [TRIGGER, RULE, GATE, BLOCK],
	edges: WorkflowEdge[] = [
		{ id: "e1", from: "t", to: "r" },
		{ id: "e2", from: "r", to: "g" },
		{ id: "e3", from: "g", to: "a", when: "fail" },
	],
): WorkflowDefinition {
	return { id: "w", name: "w", version: 1, nodes, edges };
}

const CLEAN = graph();

function only(def: WorkflowDefinition, rule: LintRuleId): LintResult[] {
	return lintWorkflow(def).filter((result) => result.rule === rule);
}

function fixed(result: LintResult | undefined, label: string): LintEdit {
	const fix = result?.fixes.find((entry) => entry.label === label);
	if (!(fix && "edit" in fix)) {
		throw new Error(`no edit fix ${label}`);
	}
	return fix.edit;
}

describe("the clean baseline", () => {
	test("the fixture and the default workflow lint clean", () => {
		expect(lintWorkflow(CLEAN)).toEqual([]);
		expect(lintWorkflow(DEFAULT_WORKFLOW)).toEqual([]);
	});

	test("every rule has a severity and a stage", () => {
		for (const spec of Object.values(LINT_RULES)) {
			expect(["error", "warning"]).toContain(spec.severity);
			expect(["structure", "enable"]).toContain(spec.stage);
		}
	});

	test("errors sort ahead of warnings", () => {
		const def = graph(
			[TRIGGER, RULE, BLOCK, { ...GATE, id: "loose" }],
			[
				{ id: "e1", from: "t", to: "r" },
				{ id: "e2", from: "r", to: "a", when: "fail" },
				{ id: "e3", from: "t", to: "x" },
			],
		);
		const severities = lintWorkflow(def).map((result) => result.severity);
		expect(severities).toEqual([...severities].sort());
	});
});

describe("schema", () => {
	test("a malformed definition reports schema problems", () => {
		const bad = { ...CLEAN, nodes: [{ ...RULE, ref: "Bad Ref" }] };
		expect(only(bad, "schema")).toHaveLength(1);
		expect(only(bad, "schema")[0]?.nodeId).toBe("r");
	});

	test("a well formed definition reports none", () => {
		expect(only(CLEAN, "schema")).toEqual([]);
	});
});

describe("no-trigger-events", () => {
	const silent = graph([{ ...TRIGGER, kinds: [] }, RULE, GATE, BLOCK]);

	test("a trigger with no events is named and the rest still lints", () => {
		const results = lintWorkflow(silent);
		expect(results.map((result) => result.rule)).toEqual(["no-trigger-events"]);
		expect(results[0]).toMatchObject({
			nodeId: "t",
			step: "Trigger",
			message: "Pick when it runs.",
			fixes: [
				{
					label: "Pick events",
					intent: { type: "focus-field", nodeId: "t", field: "kinds" },
				},
			],
		});
	});

	test("a trigger with events passes", () => {
		expect(only(CLEAN, "no-trigger-events")).toEqual([]);
	});
});

describe("duplicate-id", () => {
	test("two steps or two connections sharing an id", () => {
		const def = graph(
			[...CLEAN.nodes, { ...BLOCK, id: "r" }],
			[...CLEAN.edges, { id: "e1", from: "t", to: "a" }],
		);
		expect(only(def, "duplicate-id").map((result) => result.message)).toEqual([
			"Another step uses the same id. Rename one.",
			"Another connection uses the same id. Rename one.",
		]);
	});

	test("unique ids pass", () => {
		expect(only(CLEAN, "duplicate-id")).toEqual([]);
	});
});

describe("missing-step", () => {
	const def = graph(CLEAN.nodes, [
		...CLEAN.edges,
		{ id: "e9", from: "ghost", to: "a" },
	]);

	test("a connection to a step that does not exist", () => {
		expect(only(def, "missing-step")[0]).toMatchObject({
			edgeId: "e9",
			step: "Workflow",
			message: "A connection points to a step that is gone.",
		});
	});

	test("Remove connection clears it", () => {
		const next = applyLintEdit(
			def,
			fixed(only(def, "missing-step")[0], "Remove connection"),
		);
		expect(next.edges.map((edge) => edge.id)).toEqual(["e1", "e2", "e3"]);
		expect(only(next, "missing-step")).toEqual([]);
	});
});

describe("no-trigger", () => {
	const def = graph(
		[RULE, GATE, BLOCK],
		[
			{ id: "e2", from: "r", to: "g" },
			{ id: "e3", from: "g", to: "a", when: "fail" },
		],
	);

	test("a workflow with no trigger", () => {
		expect(only(def, "no-trigger")[0]).toMatchObject({
			step: "Workflow",
			message: "Add a trigger to start it.",
		});
		expect(only(CLEAN, "no-trigger")).toEqual([]);
	});

	test("Add trigger places one left of the graph", () => {
		const next = applyLintEdit(
			def,
			fixed(only(def, "no-trigger")[0], "Add trigger"),
		);
		expect(next.nodes[0]).toEqual({
			id: "trigger-1",
			type: "trigger",
			kinds: ["change-request.opened", "change-request.updated"],
			position: { x: 0, y: 0 },
		});
		expect(only(next, "no-trigger")).toEqual([]);
	});
});

describe("trigger-input", () => {
	const def = graph(CLEAN.nodes, [
		...CLEAN.edges,
		{ id: "e4", from: "g", to: "t" },
	]);

	test("a connection into a trigger names both steps", () => {
		expect(only(def, "trigger-input")[0]).toMatchObject({
			edgeId: "e4",
			nodeId: "t",
			step: "Trigger",
			message: "It takes no inputs.",
		});
		expect(only(CLEAN, "trigger-input")).toEqual([]);
	});

	test("Remove connection clears it", () => {
		const next = applyLintEdit(
			def,
			fixed(only(def, "trigger-input")[0], "Remove connection"),
		);
		expect(next.edges).toEqual(CLEAN.edges);
		expect(only(next, "trigger-input")).toEqual([]);
	});
});

describe("gate-input from a trigger", () => {
	const def = graph(CLEAN.nodes, [
		{ id: "e1", from: "t", to: "g" },
		{ id: "e2", from: "t", to: "r" },
		{ id: "e3", from: "g", to: "a", when: "fail" },
		{ id: "e4", from: "r", to: "a", when: "fail" },
	]);
	const [problem] = only(def, "gate-input");

	test("names the gate, the trigger and offers both fixes", () => {
		expect(problem).toEqual({
			rule: "gate-input",
			severity: "error",
			edgeId: "e1",
			nodeId: "g",
			step: "All of",
			message: "It takes rule results, not events.",
			fixes: [
				{
					label: "Insert a rule",
					intent: { type: "insert-step", edgeId: "e1" },
				},
				{
					label: "Remove connection",
					edit: { type: "remove-edge", edgeId: "e1" },
				},
			],
		});
	});

	test("Remove connection clears it", () => {
		const next = applyLintEdit(def, fixed(problem, "Remove connection"));
		expect(next.edges.map((edge) => edge.id)).toEqual(["e2", "e3", "e4"]);
		expect(only(next, "gate-input")).toEqual([]);
	});

	test("insertStep wires trigger to the rule and the rule's Passes to the gate", () => {
		const rule: WorkflowNode = {
			id: "new",
			type: "rule",
			ref: "crypto-address@1",
			config: {},
			position: { x: 300, y: 200 },
		};
		const next = insertStep(def, "e1", rule);
		expect(next.nodes.at(-1)).toEqual(rule);
		expect(next.edges).toEqual([
			{ id: "e2", from: "t", to: "r" },
			{ id: "e3", from: "g", to: "a", when: "fail" },
			{ id: "e4", from: "r", to: "a", when: "fail" },
			{ id: "edge-1", from: "t", to: "new" },
			{ id: "edge-2", from: "new", to: "g" },
		]);
		expect(only(next, "gate-input")).toEqual([]);
	});

	test("insertStep on a missing connection changes nothing", () => {
		expect(insertStep(def, "nope", RULE)).toBe(def);
	});
});

describe("Doesn't pass into a gate", () => {
	const def = graph(CLEAN.nodes, [
		{ id: "e1", from: "t", to: "r" },
		{ id: "e2", from: "r", to: "g", when: "fail" },
		{ id: "e3", from: "g", to: "a", when: "fail" },
	]);

	test("is clean, with no Not gate suggested", () => {
		expect(lintWorkflow(def)).toEqual([]);
	});
});

describe("gate-input from a decision", () => {
	const review: WorkflowNode = {
		id: "h",
		type: "action",
		action: "send-to-moderation",
	};
	const def = graph(
		[TRIGGER, RULE, review, GATE, BLOCK],
		[
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "h", when: "fail" },
			{ id: "e3", from: "h", to: "g", when: "deny" },
			{ id: "e4", from: "g", to: "a", when: "fail" },
		],
	);

	test("only offers removal", () => {
		const [problem] = only(def, "gate-input");
		expect(problem).toMatchObject({
			step: "All of",
			message: "It takes rule results, not decisions.",
		});
		const next = applyLintEdit(def, fixed(problem, "Remove connection"));
		expect(only(next, "gate-input")).toEqual([]);
	});
});

describe("no-outputs", () => {
	const def = graph(
		[...CLEAN.nodes, { id: "l", type: "action", action: "label" }],
		[...CLEAN.edges, { id: "e4", from: "a", to: "l" }],
	);

	test("an action without outputs feeding another step", () => {
		expect(only(def, "no-outputs")[0]).toMatchObject({
			edgeId: "e4",
			nodeId: "a",
			step: "Block",
			message: "It has no outputs.",
		});
		expect(only(CLEAN, "no-outputs")).toEqual([]);
	});

	test("Remove connection clears it", () => {
		const next = applyLintEdit(
			def,
			fixed(only(def, "no-outputs")[0], "Remove connection"),
		);
		expect(only(next, "no-outputs")).toEqual([]);
	});
});

describe("wrong-output", () => {
	const def = graph(CLEAN.nodes, [
		{ id: "e1", from: "t", to: "r" },
		{ id: "e2", from: "r", to: "g" },
		{ id: "e3", from: "g", to: "a", when: "approve" },
	]);

	test("an Approved edge leaving a gate", () => {
		expect(only(def, "wrong-output")[0]).toMatchObject({
			edgeId: "e3",
			step: "All of",
			message: "It has no Approved output.",
		});
		expect(only(CLEAN, "wrong-output")).toEqual([]);
	});

	test("Use Passes clears it", () => {
		const next = applyLintEdit(
			def,
			fixed(only(def, "wrong-output")[0], "Use Passes"),
		);
		expect(only(next, "wrong-output")).toEqual([]);
	});
});

describe("not-input", () => {
	const not: WorkflowNode = { id: "n", type: "gate", mode: "not" };
	const def = graph(
		[TRIGGER, RULE, { ...RULE, id: "r2" }, not, BLOCK],
		[
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "t", to: "r2" },
			{ id: "e3", from: "r", to: "n" },
			{ id: "e4", from: "r2", to: "n" },
			{ id: "e5", from: "n", to: "a", when: "fail" },
		],
	);

	test("a Not gate with two inputs", () => {
		expect(only(def, "not-input")[0]).toMatchObject({
			step: "Not",
			message: "It takes one input. Keep one.",
		});
		expect(only(CLEAN, "not-input")).toEqual([]);
	});

	test("Keep first input clears it", () => {
		const next = applyLintEdit(
			def,
			fixed(only(def, "not-input")[0], "Keep first input"),
		);
		expect(next.edges.map((edge) => edge.id)).toEqual(["e1", "e2", "e3", "e5"]);
		expect(only(next, "not-input")).toEqual([]);
	});
});

describe("orphan-step", () => {
	const loose: WorkflowNode = { ...RULE, id: "loose" };
	const def = graph([...CLEAN.nodes, loose], CLEAN.edges);
	const [problem] = only(def, "orphan-step");

	test("a step with no input", () => {
		expect(problem).toMatchObject({
			step: "Account age 2",
			message: "Nothing runs it. Connect it or delete it.",
		});
		expect(problem?.fixes.map((fix) => fix.label)).toEqual([
			"Connect",
			"Delete",
		]);
		expect(only(CLEAN, "orphan-step")).toEqual([]);
	});

	test("Connect clears it", () => {
		const next = applyLintEdit(def, fixed(problem, "Connect"));
		expect(next.edges.at(-1)).toEqual({ id: "edge-1", from: "t", to: "loose" });
		expect(only(next, "orphan-step")).toEqual([]);
	});

	test("Delete clears it", () => {
		const next = applyLintEdit(def, fixed(problem, "Delete"));
		expect(next.nodes).toEqual(CLEAN.nodes);
		expect(lintWorkflow(next)).toEqual([]);
	});

	test("an orphan gate cannot take the trigger, so only deletion is offered", () => {
		const gateDef = graph([...CLEAN.nodes, { ...GATE, id: "g2" }], CLEAN.edges);
		expect(
			only(gateDef, "orphan-step")[0]?.fixes.map((fix) => fix.label),
		).toEqual(["Delete"]);
	});
});

describe("cycle", () => {
	const def = graph(CLEAN.nodes, [
		...CLEAN.edges,
		{ id: "e4", from: "g", to: "r" },
	]);

	test("names the steps in the loop", () => {
		expect(only(def, "cycle")[0]).toMatchObject({
			edgeId: "e4",
			step: "Account age",
			message: "It loops back through All of.",
		});
		expect(only(CLEAN, "cycle")).toEqual([]);
	});

	test("a step wired to itself", () => {
		const self = graph(CLEAN.nodes, [
			...CLEAN.edges,
			{ id: "e4", from: "r", to: "r" },
		]);
		expect(only(self, "cycle")[0]).toMatchObject({
			step: "Account age",
			message: "It connects to itself.",
		});
	});

	test("Remove connection clears it", () => {
		const next = applyLintEdit(
			def,
			fixed(only(def, "cycle")[0], "Remove connection"),
		);
		expect(only(next, "cycle")).toEqual([]);
	});
});

describe("no-action", () => {
	test("no action after a trigger needs one short instruction", () => {
		const def = graph([TRIGGER, RULE], [{ id: "e1", from: "t", to: "r" }]);
		expect(only(def, "no-action")[0]).toMatchObject({
			step: "Workflow",
			message: "Add an action after the trigger.",
			fixes: [
				{
					label: "Add action",
					intent: { type: "add-next-step", nodeId: "t", port: "event" },
				},
			],
		});
		expect(only(CLEAN, "no-action")).toEqual([]);
	});
});

describe("unknown-rule", () => {
	const def = graph(
		[TRIGGER, { ...RULE, ref: "ai-review@1", config: {} }, GATE, BLOCK],
		CLEAN.edges,
	);

	test("a rule missing from the catalog", () => {
		expect(only(def, "unknown-rule")[0]?.message).toBe(
			"This rule is not in this repo.",
		);
		expect(only(CLEAN, "unknown-rule")).toEqual([]);
	});

	test("custom rules count as known when the catalog has them", () => {
		const custom = graph(
			[TRIGGER, { ...RULE, ref: "custom-x@1", config: {} }, GATE, BLOCK],
			CLEAN.edges,
		);
		const catalog = [
			...RULE_CATALOG,
			...customValidationEntries([{ ref: "custom-x@1", name: "No bots" }]),
		];
		expect(lintWorkflow(custom, { catalog })).toEqual([]);
		expect(stepDisplayName(custom.nodes[1] as WorkflowNode, catalog)).toBe(
			"No bots",
		);
	});

	test("Delete clears it", () => {
		const next = applyLintEdit(
			def,
			fixed(only(def, "unknown-rule")[0], "Delete"),
		);
		expect(only(next, "unknown-rule")).toEqual([]);
	});
});

describe("rule-config", () => {
	test("bad settings focus the field", () => {
		const def = graph([
			TRIGGER,
			{ ...RULE, config: { minDays: -1 } },
			GATE,
			BLOCK,
		]);
		const [problem] = only(def, "rule-config");
		expect(problem?.step).toBe("Account age");
		expect(problem?.message).toMatch(/^[A-Z].*\.$/);
		expect(problem?.fixes).toEqual([
			{
				label: "Edit setting",
				intent: { type: "focus-field", nodeId: "r", field: "minDays" },
			},
		]);
		expect(only(CLEAN, "rule-config")).toEqual([]);
	});
});

describe("removed-step", () => {
	const def = graph(
		[...CLEAN.nodes, { id: "c", type: "action", action: "comment" }],
		[...CLEAN.edges, { id: "e4", from: "r", to: "c", when: "fail" }],
	);

	test("a Comment step", () => {
		expect(only(def, "removed-step")[0]).toMatchObject({
			step: "Comment",
			message: "This step was removed. Customize sets the verdict comment now.",
		});
		expect(only(CLEAN, "removed-step")).toEqual([]);
	});

	test("Delete clears it and its connection", () => {
		const next = applyLintEdit(
			def,
			fixed(only(def, "removed-step")[0], "Delete"),
		);
		expect(next).toEqual(CLEAN);
	});
});

describe("review-targets", () => {
	const review = (params?: Record<string, string[]>) =>
		graph([
			TRIGGER,
			RULE,
			GATE,
			{ ...BLOCK, action: "request-review", params },
		]);

	test("asks no one: Add reviewers focuses the people field", () => {
		expect(only(review(), "review-targets")[0]).toMatchObject({
			step: "Request GitHub review",
			message: "Pick people or teams to ask.",
			fixes: [
				{
					label: "Add reviewers",
					intent: { type: "focus-field", nodeId: "a", field: "reviewers" },
				},
			],
		});
	});

	test("a bad team slug focuses the teams field", () => {
		expect(
			only(review({ teamReviewers: ["org/team"] }), "review-targets")[0],
		).toMatchObject({
			message: "Fix the reviewers: org/team is not a team slug.",
			fixes: [
				{
					label: "Edit reviewers",
					intent: { type: "focus-field", nodeId: "a", field: "teamReviewers" },
				},
			],
		});
	});

	test("with a reviewer it passes", () => {
		expect(only(review({ reviewers: ["octocat"] }), "review-targets")).toEqual(
			[],
		);
	});
});

describe("dead-end", () => {
	const def = graph(
		[...CLEAN.nodes, { ...RULE, id: "r2" }],
		[...CLEAN.edges, { id: "e4", from: "t", to: "r2" }],
	);

	test("a rule whose result goes nowhere is a warning", () => {
		expect(only(def, "dead-end")).toEqual([
			{
				rule: "dead-end",
				severity: "warning",
				nodeId: "r2",
				step: "Account age 2",
				message: "Nothing runs after it.",
				fixes: [
					{
						label: "Add step",
						intent: { type: "add-next-step", nodeId: "r2", port: "pass" },
					},
					{ label: "Delete", edit: { type: "delete-node", nodeId: "r2" } },
				],
			},
		]);
		expect(only(CLEAN, "dead-end")).toEqual([]);
	});

	test("a lone trigger only asks for an action, once", () => {
		const lone = graph([TRIGGER], []);
		expect(lintWorkflow(lone).map((result) => result.rule)).toEqual([
			"no-action",
		]);
		const withLooseTrigger = graph(
			[...CLEAN.nodes, { ...TRIGGER, id: "t2" }],
			CLEAN.edges,
		);
		expect(only(withLooseTrigger, "dead-end")).toEqual([
			expect.objectContaining({ nodeId: "t2", step: "Trigger 2" }),
		]);
	});

	test("orphans are not also dead ends", () => {
		const orphan = graph([...CLEAN.nodes, { ...RULE, id: "r2" }], CLEAN.edges);
		expect(only(orphan, "dead-end")).toEqual([]);
	});

	test("Delete clears it", () => {
		const next = applyLintEdit(def, fixed(only(def, "dead-end")[0], "Delete"));
		expect(lintWorkflow(next)).toEqual([]);
	});
});

describe("connection hints for the drag chip", () => {
	test("a gate refuses events and decisions, and takes both results", () => {
		expect(portHint(GATE, "event", "All of")).toEqual({
			rule: "gate-input",
			message: "All of takes rule results, not events",
		});
		expect(portHint(GATE, "fail", "All of")).toBeNull();
		expect(portHint(GATE, "deny", "All of")?.message).toBe(
			"All of takes rule results, not decisions",
		);
		expect(portHint(GATE, "pass", "All of")).toBeNull();
	});

	test("a trigger refuses everything; rules and actions take anything", () => {
		expect(portHint(TRIGGER, "pass", "Trigger")).toEqual({
			rule: "trigger-input",
			message: "Trigger takes no inputs",
		});
		for (const port of ["event", "pass", "fail", "approve", "deny"] as const) {
			expect(portHint(RULE, port, "Account age")).toBeNull();
			expect(portHint(BLOCK, port, "Block")).toBeNull();
		}
	});

	test("outputs a step does not have", () => {
		expect(outputHint(BLOCK, "pass", "Block")).toEqual({
			rule: "no-outputs",
			message: "Block has no outputs",
		});
		expect(outputHint(RULE, "approve", "Account age")?.rule).toBe(
			"wrong-output",
		);
		expect(outputHint(RULE, "fail", "Account age")).toBeNull();
	});
});

describe("openPosition", () => {
	test("keeps a free spot", () => {
		expect(openPosition(CLEAN, { x: 300, y: 400 })).toEqual({ x: 300, y: 400 });
	});

	test("moves to the nearest free row when a step is in the way", () => {
		expect(openPosition(CLEAN, { x: 320, y: 20 })).toEqual({ x: 320, y: 140 });
		expect(openPosition(CLEAN, { x: 320, y: -20 })).toEqual({
			x: 320,
			y: -140,
		});
	});
});

describe("delivery and label steps need their settings to go live", () => {
	function withAction(
		action: Extract<WorkflowNode, { type: "action" }>,
	): WorkflowDefinition {
		return {
			id: "w",
			name: "w",
			version: 1,
			nodes: [
				{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
				action,
			],
			edges: [{ id: "e", from: "t", to: action.id }],
		};
	}

	test("a webhook, Discord or label step with nothing set cannot go live", () => {
		for (const action of ["webhook", "discord", "label"] as const) {
			const result = validateWorkflowForEnable(
				withAction({ id: "x", type: "action", action }),
			);
			expect({ action, valid: result.valid }).toEqual({ action, valid: false });
		}
	});

	test("a webhook URL must use https, a Discord URL must be a Discord webhook", () => {
		expect(
			validateWorkflowForEnable(
				withAction({
					id: "x",
					type: "action",
					action: "webhook",
					params: { url: "http://169.254.169.254/latest" },
				}),
			).valid,
		).toBe(false);
		expect(
			validateWorkflowForEnable(
				withAction({
					id: "x",
					type: "action",
					action: "discord",
					params: { url: "https://evil.example/x" },
				}),
			).valid,
		).toBe(false);
	});

	test("a stored URL, or the marker that one is stored, passes", () => {
		const stored: Record<string, JsonValue>[] = [
			{ url: "https://hooks.example.com/tripwire" },
			{ url: "", urlSet: true },
		];
		for (const params of stored) {
			expect(
				validateWorkflowForEnable(
					withAction({ id: "x", type: "action", action: "webhook", params }),
				).valid,
			).toBe(true);
		}
		expect(
			validateWorkflowForEnable(
				withAction({
					id: "x",
					type: "action",
					action: "discord",
					params: { url: "https://discord.com/api/webhooks/1/abc" },
				}),
			).valid,
		).toBe(true);
		expect(
			validateWorkflowForEnable(
				withAction({
					id: "x",
					type: "action",
					action: "label",
					params: { labels: ["triage"] },
				}),
			).valid,
		).toBe(true);
	});
});
