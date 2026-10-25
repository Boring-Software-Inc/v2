import { describe, expect, test } from "bun:test";
import {
	DEFAULT_WORKFLOW,
	exceptionDraft,
	RULE_CATALOG,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import {
	aiCreditsOf,
	definitionToGraph,
	type EditorEdge,
	type EditorNode,
	editorLint,
	gateInputFor,
	gateInputTaken,
	graphToDefinition,
	handleInput,
} from "./workflow-editor.ts";

/** Positions are layout, persisted since the editor rebuild — identity is
 * asserted mod layout, and position fidelity has its own test below. */
function stripPositions(def: WorkflowDefinition): WorkflowDefinition {
	return {
		...def,
		nodes: def.nodes.map(
			({ position: _p, ...node }) => node,
		) as WorkflowDefinition["nodes"],
	};
}

describe("workflow editor round-trip", () => {
	test("definition → graph → definition is identity (mod layout)", () => {
		const graph = definitionToGraph(DEFAULT_WORKFLOW);
		const result = graphToDefinition(
			{
				id: DEFAULT_WORKFLOW.id,
				name: DEFAULT_WORKFLOW.name,
				version: DEFAULT_WORKFLOW.version,
			},
			graph.nodes,
			graph.edges,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(stripPositions(result.definition)).toEqual(
				stripPositions(DEFAULT_WORKFLOW),
			);
			// And every emitted node now carries its canvas position.
			expect(result.definition.nodes.every((n) => n.position)).toBe(true);
		}
	});

	test("stored positions survive definition → graph → definition", () => {
		const positioned: WorkflowDefinition = {
			...DEFAULT_WORKFLOW,
			nodes: DEFAULT_WORKFLOW.nodes.map((node, i) => ({
				...node,
				position: { x: 42 + i, y: 1000 - i },
			})),
		};
		const graph = definitionToGraph(positioned);
		// The graph honors the stored positions, not the derived layout…
		expect(graph.nodes[0]?.position).toEqual({ x: 42, y: 1000 });
		const result = graphToDefinition(
			{ id: positioned.id, name: positioned.name, version: positioned.version },
			graph.nodes,
			graph.edges,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			// …and the emission carries them back out unchanged.
			expect(result.definition).toEqual(positioned);
		}
	});

	test("the emission parses against the contract schema", () => {
		const graph = definitionToGraph(DEFAULT_WORKFLOW);
		const result = graphToDefinition(
			{ id: "w", name: "w", version: 1 },
			graph.nodes,
			graph.edges,
		);
		if (!result.ok) {
			throw new Error(result.error);
		}
		expect(() =>
			workflowDefinitionSchema.parse(result.definition),
		).not.toThrow();
	});

	test("a broken graph (edge without nodes) is rejected at emission", () => {
		const result = graphToDefinition(
			{ id: "w", name: "w", version: 1 },
			[],
			[{ id: "e", source: "a", target: "b" }],
		);
		expect(result.ok).toBe(false);
	});
});

describe("outcome handles ↔ when (T4 editor fix)", () => {
	const node = (n: WorkflowDefinition["nodes"][number]): EditorNode => ({
		id: n.id,
		position: { x: 0, y: 0 },
		data: { node: n },
		type: "tripwire",
	});
	const T4_NODES = [
		node({
			id: "trigger",
			type: "trigger",
			kinds: ["change-request.opened"],
		}),
		node({ id: "age", type: "rule", ref: "account-age@1", config: {} }),
		node({ id: "mod", type: "action", action: "send-to-moderation" }),
		node({ id: "block", type: "action", action: "block" }),
	];

	test('an edge drawn from the fail handle saves as when:"fail"', () => {
		const result = graphToDefinition(
			{ id: "w", name: "w", version: 1 },
			T4_NODES,
			[
				{ id: "e1", source: "trigger", target: "age" },
				{ id: "e2", source: "age", target: "mod", sourceHandle: "fail" },
			],
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.definition.edges[1]?.when).toBe("fail");
		}
	});

	test("approve/deny handles on send-to-moderation save as their when", () => {
		const result = graphToDefinition(
			{ id: "w", name: "w", version: 1 },
			T4_NODES,
			[
				{ id: "e1", source: "trigger", target: "age" },
				{ id: "e2", source: "age", target: "mod", sourceHandle: "fail" },
				{ id: "e3", source: "mod", target: "block", sourceHandle: "deny" },
			],
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.definition.edges[2]?.when).toBe("deny");
		}
	});

	test("the handle wins over a stale stored when", () => {
		const edges: EditorEdge[] = [
			{ id: "e1", source: "trigger", target: "age" },
			{
				id: "e2",
				source: "age",
				target: "mod",
				sourceHandle: "fail",
				data: { when: "pass" },
			},
		];
		const result = graphToDefinition(
			{ id: "w", name: "w", version: 1 },
			T4_NODES,
			edges,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.definition.edges[1]?.when).toBe("fail");
		}
	});

	test("when-edges reload onto their outcome handle", () => {
		const definition: WorkflowDefinition = {
			id: "w",
			name: "w",
			version: 1,
			nodes: T4_NODES.map((n) => n.data.node),
			edges: [
				{ id: "e1", from: "trigger", to: "age" },
				{ id: "e2", from: "age", to: "mod", when: "fail" },
				{ id: "e3", from: "mod", to: "block", when: "deny" },
			],
		};
		const graph = definitionToGraph(definition);
		expect(graph.edges[0]?.sourceHandle).toBeUndefined();
		expect(graph.edges[1]?.sourceHandle).toBe("fail");
		expect(graph.edges[2]?.sourceHandle).toBe("deny");
	});

	test("full round-trip: fail + deny edges survive graph → definition → graph", () => {
		const definition: WorkflowDefinition = {
			id: "w",
			name: "w",
			version: 1,
			nodes: T4_NODES.map((n) => n.data.node),
			edges: [
				{ id: "e1", from: "trigger", to: "age" },
				{ id: "e2", from: "age", to: "mod", when: "fail" },
				{ id: "e3", from: "mod", to: "block", when: "deny" },
			],
		};
		const graph = definitionToGraph(definition);
		const result = graphToDefinition(
			{ id: "w", name: "w", version: 1 },
			graph.nodes,
			graph.edges,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(stripPositions(result.definition)).toEqual(
				stripPositions(definition),
			);
		}
	});

	test("a saved workflow round-trips load then save to identical json", () => {
		const saved: WorkflowDefinition = {
			id: "w",
			name: "w",
			version: 3,
			nodes: T4_NODES.map((n, i) => ({
				...n.data.node,
				position: { x: 10 * i, y: 20 * i },
			})),
			edges: [
				{ id: "e1", from: "trigger", to: "age", when: "pass" },
				{ id: "e2", from: "age", to: "mod", when: "fail" },
				{ id: "e3", from: "mod", to: "block", when: "deny" },
				{ id: "e4", from: "mod", to: "trigger", when: "approve" },
				{ id: "e5", from: "age", to: "block" },
			],
		};
		const graph = definitionToGraph(saved);
		const result = graphToDefinition(
			{ id: saved.id, name: saved.name, version: saved.version },
			graph.nodes,
			graph.edges,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(JSON.stringify(result.definition)).toBe(JSON.stringify(saved));
		}
	});

	test("edges carry no text label: the source port names the outcome", () => {
		const graph = definitionToGraph({
			id: "w",
			name: "w",
			version: 1,
			nodes: T4_NODES.map((n) => n.data.node),
			edges: [
				{ id: "e1", from: "trigger", to: "age" },
				{ id: "e2", from: "age", to: "mod", when: "fail" },
				{ id: "e3", from: "mod", to: "block", when: "deny" },
				{ id: "e4", from: "mod", to: "age", when: "approve" },
				{ id: "e5", from: "age", to: "block", when: "pass" },
			],
		});
		expect(graph.edges.map((edge) => "label" in edge)).toEqual([
			false,
			false,
			false,
			false,
			false,
		]);
		expect(graph.edges.map((edge) => edge.data?.when)).toEqual([
			undefined,
			"fail",
			"deny",
			"approve",
			"pass",
		]);
	});
});

describe("AI review steps while Tripwire is out of AI credits", () => {
	const ai = (id: string) =>
		({
			id,
			type: "rule",
			ref: "ai-review@2",
			config: { maxSteps: 12 },
		}) as const;
	const stored: WorkflowDefinition = {
		id: "w",
		name: "w",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			ai("old"),
			{ id: "a", type: "action", action: "block" },
		],
		edges: [
			{ id: "e1", from: "t", to: "old" },
			{ id: "e2", from: "old", to: "a", when: "fail" },
		],
	};
	const added: WorkflowDefinition = {
		...stored,
		nodes: [...stored.nodes, ai("new")],
		edges: [...stored.edges, { id: "e3", from: "t", to: "new" }],
	};
	const credits = (candidate: WorkflowDefinition, enabled: boolean) =>
		editorLint({
			candidate,
			enabled,
			catalog: RULE_CATALOG,
			aiCredits: "out",
		})
			.filter((issue) => issue.rule === "rule-unavailable")
			.map((issue) => [issue.nodeId, issue.severity, issue.message]);

	test("every AI review step on a live workflow carries a quiet warning", () => {
		expect(credits(added, true)).toEqual([
			["old", "warning", "AI review can't run until credits return."],
			["new", "warning", "AI review can't run until credits return."],
		]);
	});

	test("nothing on a live workflow blocks a save or reads as a fix", () => {
		expect(
			editorLint({
				candidate: added,
				enabled: true,
				catalog: RULE_CATALOG,
				aiCredits: "out",
			}).filter((issue) => issue.severity === "error"),
		).toEqual(
			editorLint({
				candidate: added,
				enabled: true,
				catalog: RULE_CATALOG,
				aiCredits: "ready",
			}).filter((issue) => issue.severity === "error"),
		);
	});

	test("an off workflow shows no AI review issue at all", () => {
		expect(credits(added, false)).toEqual([]);
	});

	test("with credits there is no issue", () => {
		expect(
			editorLint({
				candidate: added,
				enabled: true,
				catalog: RULE_CATALOG,
				aiCredits: "ready",
			}).filter((issue) => issue.rule === "rule-unavailable"),
		).toEqual([]);
	});

	test("the rules page's AI review status is the credit state", () => {
		expect(
			aiCreditsOf([
				{ ruleId: "account-age", unavailableReason: null },
				{ ruleId: "ai-review", unavailableReason: "Out of AI credits" },
			]),
		).toBe("out");
		expect(
			aiCreditsOf([{ ruleId: "ai-review", unavailableReason: null }]),
		).toBe("ready");
		expect(aiCreditsOf(undefined)).toBe("ready");
	});
});

describe("Except when on the canvas", () => {
	test("requirement and exception roles survive definition, graph and back", () => {
		const draft = exceptionDraft({
			id: "wf",
			name: "Target is main",
			rule: {
				ref: "account-age@1",
				config: { minDays: 7 },
				outcome: {
					outcome: "request_fix",
					instruction: "Change the target to main.",
				},
			},
		});
		const graph = definitionToGraph(draft);
		expect(
			graph.edges.find((edge) => edge.id === "requirement-gate")?.targetHandle,
		).toBe("requirement");
		const result = graphToDefinition(
			{ id: draft.id, name: draft.name, version: draft.version },
			graph.nodes,
			graph.edges,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.definition.edges).toEqual(draft.edges);
		}
	});

	test("a handle that is not a gate input stores no role", () => {
		expect(handleInput("requirement")).toBe("requirement");
		expect(handleInput("exception")).toBe("exception");
		expect(handleInput(null)).toBeUndefined();
		expect(handleInput("fail")).toBeUndefined();
	});
});

describe("connecting into Except when", () => {
	const gate = { id: "g", type: "gate", mode: "unless" } as const;
	const allOf = { id: "a", type: "gate", mode: "all-of" } as const;

	test("a drop on the node fills Requirement first, then Exception", () => {
		expect(gateInputFor(gate, null, [])).toBe("requirement");
		expect(
			gateInputFor(gate, null, [{ target: "g", targetHandle: "requirement" }]),
		).toBe("exception");
	});

	test("a drop on a port keeps that port, and other nodes get no role", () => {
		expect(gateInputFor(gate, "exception", [])).toBe("exception");
		expect(gateInputFor(allOf, "exception", [])).toBeNull();
	});

	test("a filled port refuses a second connection", () => {
		const edges = [{ target: "g", targetHandle: "requirement" }];
		expect(gateInputTaken(gate, "requirement", edges)).toBe(true);
		expect(gateInputTaken(gate, "exception", edges)).toBe(false);
		expect(gateInputTaken(allOf, "requirement", edges)).toBe(false);
	});
});
