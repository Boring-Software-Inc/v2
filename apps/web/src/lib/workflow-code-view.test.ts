import { describe, expect, test } from "bun:test";
import {
	WORKFLOW_TEMPLATES,
	type WorkflowDefinition,
	workflowToCode,
} from "@tripwire/contracts";
import { workflowCodeView } from "./workflow-code-view.ts";
import { definitionToGraph, graphToCandidate } from "./workflow-editor.ts";
import { workflowEditorSearchSchema } from "./workflow-editor-search.ts";

const HOOKED: WorkflowDefinition = {
	id: "hooked",
	name: "Hooked",
	version: 2,
	nodes: [
		{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
		{ id: "age", type: "rule", ref: "account-age@1", config: { minDays: 7 } },
		{
			id: "hook",
			type: "action",
			action: "webhook",
			params: { url: "", urlSet: true },
		},
		{
			id: "tag",
			type: "action",
			action: "label",
			params: { labels: ["new"] },
		},
	],
	edges: [
		{ id: "e1", from: "t", to: "age" },
		{ id: "e2", from: "age", to: "hook", when: "fail" },
		{ id: "e3", from: "age", to: "tag", when: "fail" },
	],
};

function throughCanvas(definition: WorkflowDefinition): WorkflowDefinition {
	const graph = definitionToGraph(definition);
	return graphToCandidate(
		{ id: definition.id, name: definition.name, version: definition.version },
		graph.nodes,
		graph.edges,
	);
}

function codeOf(definition: WorkflowDefinition): string {
	const result = workflowToCode(definition);
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result.code;
}

describe("the code view shows what pull writes", () => {
	const saved = [HOOKED, ...WORKFLOW_TEMPLATES.map((t) => t.definition)];
	for (const definition of saved) {
		test(`${definition.name}: an untouched canvas is the pulled file`, () => {
			expect(workflowCodeView(throughCanvas(definition), definition)).toEqual({
				kind: "code",
				code: codeOf(definition),
				saved: codeOf(definition),
				warnings: [],
				unsaved: false,
			});
		});
	}

	test("moving a step is layout, so the code is still saved", () => {
		const moved = throughCanvas(HOOKED);
		const view = workflowCodeView(
			{
				...moved,
				nodes: moved.nodes.map((node) => ({
					...node,
					position: { x: 999, y: 999 },
				})),
			},
			HOOKED,
		);
		expect(view).toMatchObject({ kind: "code", unsaved: false });
	});

	test("an unsaved edit shows in the code and marks it unsaved", () => {
		const edited = throughCanvas(HOOKED);
		const view = workflowCodeView(
			{
				...edited,
				nodes: edited.nodes.map((node) =>
					node.id === "age" && node.type === "rule"
						? { ...node, config: { minDays: 30 } }
						: node,
				),
			},
			HOOKED,
		);
		expect(view.kind).toBe("code");
		if (view.kind === "code") {
			expect(view.unsaved).toBe(true);
			expect(view.code).toContain("minDays: 30");
			expect(view.saved).not.toBeNull();
			expect(view.saved).not.toContain("minDays: 30");
			expect(view.saved).not.toBe(view.code);
		}
	});

	test("saved code is the saved workflow, so a diff compares the two", () => {
		const view = workflowCodeView(throughCanvas(HOOKED), HOOKED);
		expect(view.kind).toBe("code");
		if (view.kind === "code") {
			expect(view.saved).toBe(view.code);
		}
	});

	test("a delivery address typed into the canvas never shows", () => {
		const typed = throughCanvas(HOOKED);
		const view = workflowCodeView(
			{
				...typed,
				nodes: typed.nodes.map((node) =>
					node.id === "hook" && node.type === "action"
						? {
								...node,
								params: { url: "https://discord.com/api/webhooks/1/secret" },
							}
						: node,
				),
			},
			HOOKED,
		);
		expect(JSON.stringify(view)).not.toContain("discord.com");
		expect(view).toMatchObject({ kind: "code", unsaved: false });
	});
});

describe("a workflow code cannot say shows the reason", () => {
	const gated: WorkflowDefinition = {
		id: "gated",
		name: "Gated",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "both", type: "gate", mode: "all-of" },
			{ id: "x", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "both" },
			{ id: "e2", from: "both", to: "x" },
		],
	};

	test("a gate fed by an event", () => {
		const view = workflowCodeView(gated, HOOKED);
		expect(view.kind).toBe("refused");
		expect(view.kind === "refused" ? view.reason : "").toBe(
			"The All of gate takes rule results, not events.",
		);
	});

	test("a step the schema rejects", () => {
		const view = workflowCodeView(
			{
				...gated,
				nodes: [{ id: "", type: "trigger", kinds: [] }],
				edges: [],
			},
			gated,
		);
		expect(view.kind).toBe("refused");
	});
});

describe("the view lives in the URL", () => {
	test("canvas unless the link says code", () => {
		expect(workflowEditorSearchSchema.parse({})).toEqual({ view: "canvas" });
		expect(workflowEditorSearchSchema.parse({ view: "code" })).toEqual({
			view: "code",
		});
		expect(workflowEditorSearchSchema.parse({ view: "yaml" })).toEqual({
			view: "canvas",
		});
	});
});
