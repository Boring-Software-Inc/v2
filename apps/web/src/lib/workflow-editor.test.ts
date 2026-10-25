import { describe, expect, test } from "bun:test";
import {
	applyLintEdit,
	compileWorkflows,
	DEFAULT_WORKFLOW,
	diffWorkflow,
	insertStep,
	lintWorkflow,
	RULE_CATALOG,
	type WorkflowDefinition,
	workflowAuthoring,
	workflowDefinitionSchema,
	workflowsToCode,
} from "@tripwire/contracts";
import {
	aiCreditsOf,
	definitionToGraph,
	type EditorEdge,
	type EditorNode,
	editorLint,
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

describe("Except when keeps its requirement and exception through the editor", () => {
	const {
		allOf,
		customCheck,
		requestFix,
		trigger,
		unless,
		workflow,
		workflows,
	} = workflowAuthoring;
	const on = trigger("change-request.opened", "change-request.updated");
	const compiled = compileWorkflows(
		workflows({
			target: workflow({
				on,
				check: unless(
					customCheck("custom-target-main"),
					allOf(
						customCheck("custom-target-release"),
						customCheck("custom-release-author"),
					),
				),
				fail: [requestFix({ message: "Change the target to main." })],
			}),
		}),
	);
	const first = compiled.ok ? compiled.definitions[0] : undefined;
	if (!first) {
		throw new Error("fixture does not compile");
	}
	const original: WorkflowDefinition = first;
	const roles = (def: WorkflowDefinition) =>
		def.edges.flatMap((edge) =>
			edge.input ? [`${edge.from}>${edge.to}:${edge.input}`] : [],
		);

	function save(edges: EditorEdge[], nodes: EditorNode[]) {
		const result = graphToDefinition(
			{ id: original.id, name: original.name, version: original.version },
			nodes,
			edges,
		);
		if (!result.ok) {
			throw new Error(result.error);
		}
		return result.definition;
	}

	test("tripwire.ts to editor graph to save to code is identical", () => {
		const graph = definitionToGraph(original);
		const saved = save(graph.edges, graph.nodes);
		expect(stripPositions(saved)).toEqual(original);
		expect(roles(saved)).toEqual([
			"custom-target-main>unless:requirement",
			"all-of>unless:exception",
		]);
		const { code, warnings } = workflowsToCode([saved], {
			importFrom: "./.tripwire/workflow.ts",
		});
		expect(warnings).toEqual([]);
		expect(code).toContain("unless(customTargetMain, allOfStep)");
		expect(
			lintWorkflow(saved).filter((issue) => issue.rule === "unless-inputs"),
		).toEqual([]);
	});

	test("edge order on the canvas never swaps the roles", () => {
		const graph = definitionToGraph(original);
		const saved = save([...graph.edges].reverse(), graph.nodes);
		expect(roles(saved).sort()).toEqual(
			[
				"all-of>unless:exception",
				"custom-target-main>unless:requirement",
			].sort(),
		);
		const { code } = workflowsToCode([saved], {
			importFrom: "./.tripwire/workflow.ts",
		});
		expect(code).toContain("unless(customTargetMain, allOfStep)");
	});

	test("editor edits keep the roles: use passes, insert a step, and the diff names a swap", () => {
		const requirement = original.edges.find(
			(edge) => edge.input === "requirement",
		);
		if (!requirement) {
			throw new Error("no requirement edge");
		}
		const passes = applyLintEdit(original, {
			type: "use-passes",
			edgeId: requirement.id,
		});
		expect(roles(passes)).toEqual(roles(original));
		const inserted = insertStep(original, requirement.id, {
			id: "not-gate",
			type: "gate",
			mode: "not",
		});
		expect(roles(inserted)).toContain("not-gate>unless:requirement");
		expect(
			inserted.edges.find((edge) => edge.to === "not-gate")?.input,
		).toBeUndefined();
		const swapped = {
			...original,
			edges: original.edges.map((edge) =>
				edge.input === "requirement"
					? { ...edge, input: "exception" as const }
					: edge.input === "exception"
						? { ...edge, input: "requirement" as const }
						: edge,
			),
		};
		expect(diffWorkflow(original, swapped).length).toBeGreaterThan(0);
	});
});
