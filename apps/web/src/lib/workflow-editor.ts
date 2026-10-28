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
	gateInputSchema,
	issuesInState,
	lintWorkflow,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { isViewEdge, type RuleCard, ruleGroupsView } from "#/lib/rule-groups";

/**
 * Pure graph ↔ definition converters. `graphToDefinition` is THE editor
 * emission — it produces exactly the JSON the executor has eaten since build
 * step 6; the round-trip is proven in tests (web identity + worker
 * validate→execute over a committed editor emission).
 */

export type EditorNodeType = "tripwire" | "ruleGroup" | "skipWhen";

export interface EditorNode {
	id: string;
	position: { x: number; y: number };
	data: { node: WorkflowNode };
	type: EditorNodeType;
	hidden?: boolean;
}

export interface EditorEdgeData {
	when?: EdgeWhen;
	input?: GateInput;
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
	targetHandle?: string | null;
	hidden?: boolean;
	deletable?: boolean;
	selectable?: boolean;
	reconnectable?: boolean;
	data?: EditorEdgeData;
}

export function handleInput(
	targetHandle: string | null | undefined,
): GateInput | undefined {
	const parsed = gateInputSchema.safeParse(targetHandle);
	return parsed.success ? parsed.data : undefined;
}

export function edgeWhenFields(when: EdgeWhen | undefined): {
	data: { when?: EdgeWhen };
} {
	return when ? { data: { when } } : { data: {} };
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

function nodeType(card: RuleCard | undefined): EditorNodeType {
	if (card?.kind === "group") {
		return "ruleGroup";
	}
	return card?.kind === "skip" ? "skipWhen" : "tripwire";
}

/**
 * Stored positions win (the user arranged them). Nodes without one get the
 * core's lane layout from `placeUnpositioned`; the origin here is a
 * placeholder it replaces.
 */
export interface EditorGraph {
	nodes: EditorNode[];
	edges: EditorEdge[];
}

export function definitionToGraph(definition: WorkflowDefinition): EditorGraph {
	const view = ruleGroupsView(definition);
	const nodes = definition.nodes.map(
		(node): EditorNode => ({
			id: node.id,
			position: node.position ?? { x: 0, y: 0 },
			data: { node },
			type: nodeType(view.cards.get(node.id)),
			hidden: view.memberOf.has(node.id),
		}),
	);
	const edges = definition.edges.map((edge): EditorEdge => {
		const data: EditorEdgeData = edge.when ? { when: edge.when } : {};
		if (edge.input) {
			data.input = edge.input;
		}
		const shown: EditorEdge = {
			id: edge.id,
			source: edge.from,
			target: edge.to,
			sourceHandle:
				edge.when && HANDLE_WHENS.has(edge.when) ? edge.when : undefined,
			targetHandle: undefined,
			hidden: view.hiddenEdges.has(edge.id),
			data,
		};
		if (edge.input) {
			shown.deletable = false;
			shown.reconnectable = false;
		}
		return shown;
	});
	const viewEdges = view.viewEdges.map(
		(edge): EditorEdge => ({
			id: edge.id,
			source: edge.from,
			target: edge.to,
			deletable: false,
			selectable: false,
			reconnectable: false,
			data: {},
		}),
	);
	return { nodes, edges: [...edges, ...viewEdges] };
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
	targetHandle?: string | null;
	data?: EditorEdgeData;
}

function graphEdge(edge: GraphEdgeLike): WorkflowDefinition["edges"][number] {
	const out: WorkflowDefinition["edges"][number] = {
		id: edge.id,
		from: edge.source,
		to: edge.target,
	};
	const when = handleWhen(edge.sourceHandle) ?? edge.data?.when;
	if (when) {
		out.when = when;
	}
	const input = handleInput(edge.targetHandle) ?? edge.data?.input;
	if (input) {
		out.input = input;
	}
	return out;
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
		edges: edges.filter((edge) => !isViewEdge(edge.id)).map(graphEdge),
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
