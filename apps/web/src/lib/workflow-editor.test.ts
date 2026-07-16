import { describe, expect, test } from "bun:test";
import {
	DEFAULT_WORKFLOW,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import {
	definitionToGraph,
	type EditorNode,
	graphToDefinition,
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

	test("the handle wins over a stale label", () => {
		const result = graphToDefinition(
			{ id: "w", name: "w", version: 1 },
			T4_NODES,
			[
				{ id: "e1", source: "trigger", target: "age" },
				{
					id: "e2",
					source: "age",
					target: "mod",
					sourceHandle: "fail",
					label: "pass",
				},
			],
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
});
