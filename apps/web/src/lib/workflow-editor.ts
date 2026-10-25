import type {
	AiCreditsState,
	EdgeWhen,
	GateInput,
	LintResult,
	ReviewerRef,
	ValidationCatalogEntry,
	WorkflowDefinition,
	WorkflowNode,
} from "@tripwire/contracts";
import {
	AI_REVIEW_RULE_ID,
	catalogWithAiCredits,
	issuesInState,
	lintWorkflow,
	workflowDefinitionSchema,
} from "@tripwire/contracts";

/**
 * Pure graph ↔ definition converters. `graphToDefinition` is THE editor
 * emission — it produces exactly the JSON the executor has eaten since build
 * step 6; the round-trip is proven in tests (web identity + worker
 * validate→execute over a committed editor emission).
 */

export interface EditorNode {
	id: string;
	position: { x: number; y: number };
	data: { node: WorkflowNode };
	type: "tripwire";
}

export interface EditorEdge {
	id: string;
	source: string;
	target: string;
	/**
	 * Outcome handles set this to their `when` ("fail" on rule/gate nodes,
	 * "approve"/"deny" on send-to-moderation nodes); pass edges leave it unset.
	 */
	sourceHandle?: string | null;
	data?: EditorEdgeData;
}

export interface EditorEdgeData {
	when?: EdgeWhen;
	input?: GateInput;
}

export function edgeWhenFields(
	when: EdgeWhen | undefined,
	input?: GateInput,
): {
	data: EditorEdgeData;
} {
	return {
		data: {
			...(when ? { when } : {}),
			...(input ? { input } : {}),
		},
	};
}

const HANDLE_WHENS = new Set(["fail", "approve", "deny"]);

/**
 * The handle an edge was drawn from is the source of truth for its `when` —
 * stored data can go stale, the handle cannot.
 */
export function handleWhen(
	sourceHandle: string | null | undefined,
): "fail" | "approve" | "deny" | undefined {
	return sourceHandle && HANDLE_WHENS.has(sourceHandle)
		? (sourceHandle as "fail" | "approve" | "deny")
		: undefined;
}

/**
 * Stored positions win (the user arranged them). Nodes without one get the
 * core's lane layout from `placeUnpositioned`; the origin here is a
 * placeholder it replaces.
 */
export function definitionToGraph(definition: WorkflowDefinition): {
	nodes: EditorNode[];
	edges: EditorEdge[];
} {
	const nodes = definition.nodes.map((node) => ({
		id: node.id,
		position: node.position ?? { x: 0, y: 0 },
		data: { node },
		type: "tripwire" as const,
	}));
	const edges = definition.edges.map((edge) => ({
		id: edge.id,
		source: edge.from,
		target: edge.to,
		sourceHandle:
			edge.when && HANDLE_WHENS.has(edge.when) ? edge.when : undefined,
		...edgeWhenFields(edge.when, edge.input),
	}));
	return { nodes, edges };
}

export type GraphToDefinitionResult =
	| { ok: true; definition: WorkflowDefinition }
	| { ok: false; error: string };

export interface GraphNodeLike {
	id: string;
	position: { x: number; y: number };
	data: { node: WorkflowNode };
}

export interface GraphEdgeLike {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string | null;
	data?: EditorEdgeData;
}

export function graphToCandidate(
	meta: { id: string; name: string; version: number },
	nodes: readonly GraphNodeLike[],
	edges: readonly GraphEdgeLike[],
): WorkflowDefinition {
	return {
		id: meta.id,
		name: meta.name,
		version: meta.version,
		// Canvas position rides along on the wire (optional, executor-inert) so
		// the user's arrangement survives the round trip.
		nodes: nodes.map((node) => ({
			...node.data.node,
			position: node.position,
		})),
		edges: edges.map((edge) => ({
			id: edge.id,
			from: edge.source,
			to: edge.target,
			...(() => {
				const when = handleWhen(edge.sourceHandle) ?? edge.data?.when;
				return when ? { when } : {};
			})(),
			...(edge.data?.input ? { input: edge.data.input } : {}),
		})),
	};
}

export function graphToDefinition(
	meta: { id: string; name: string; version: number },
	nodes: readonly GraphNodeLike[],
	edges: readonly GraphEdgeLike[],
): GraphToDefinitionResult {
	const candidate = graphToCandidate(meta, nodes, edges);
	const parsed = workflowDefinitionSchema.safeParse(candidate);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return {
			ok: false,
			error: `Tripwire could not save this workflow. Check ${issue?.path.join(".") || "the workflow"}: ${issue?.message}`,
		};
	}
	return { ok: true, definition: parsed.data };
}

export function aiCreditsOf(
	views:
		| readonly { ruleId: string; unavailableReason: string | null }[]
		| undefined,
): AiCreditsState {
	return views?.some(
		(view) => view.ruleId === AI_REVIEW_RULE_ID && view.unavailableReason,
	)
		? "out"
		: "ready";
}

/**
 * The editor's issues, checked the way the server checks a save. An off
 * workflow leaves out the rules that can't run right now.
 */
export function editorLint(input: {
	candidate: WorkflowDefinition;
	enabled: boolean;
	catalog: readonly ValidationCatalogEntry[];
	aiCredits: AiCreditsState;
	reviewers?: readonly ReviewerRef[];
}): LintResult[] {
	const results = lintWorkflow(input.candidate, {
		catalog: catalogWithAiCredits(input.catalog, input.aiCredits),
		reviewers: input.reviewers,
	});
	return issuesInState(results, input.enabled);
}
