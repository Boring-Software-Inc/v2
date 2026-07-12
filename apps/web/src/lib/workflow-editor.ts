import type {
	WorkflowDefinition,
	WorkflowEdge,
	WorkflowNode,
} from "@tripwire/contracts";
import { workflowDefinitionSchema } from "@tripwire/contracts";

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
	label?: string;
}

const HANDLE_WHENS = new Set(["fail", "approve", "deny"]);

/**
 * The handle an edge was drawn from is the source of truth for its `when` —
 * a label can go stale, the handle cannot.
 */
export function handleWhen(
	sourceHandle: string | null | undefined,
): "fail" | "approve" | "deny" | undefined {
	return sourceHandle && HANDLE_WHENS.has(sourceHandle)
		? (sourceHandle as "fail" | "approve" | "deny")
		: undefined;
}

function depthOf(
	nodeId: string,
	edges: WorkflowEdge[],
	memo = new Map<string, number>(),
): number {
	const cached = memo.get(nodeId);
	if (cached !== undefined) {
		return cached;
	}
	memo.set(nodeId, 0);
	const incoming = edges.filter((edge) => edge.to === nodeId);
	const depth =
		incoming.length === 0
			? 0
			: 1 +
				Math.max(...incoming.map((edge) => depthOf(edge.from, edges, memo)));
	memo.set(nodeId, depth);
	return depth;
}

/** Layered layout: columns by topo depth, rows by arrival order. */
export function definitionToGraph(definition: WorkflowDefinition): {
	nodes: EditorNode[];
	edges: EditorEdge[];
} {
	const rows = new Map<number, number>();
	const nodes = definition.nodes.map((node) => {
		const depth = depthOf(node.id, definition.edges);
		const row = rows.get(depth) ?? 0;
		rows.set(depth, row + 1);
		return {
			id: node.id,
			position: { x: depth * 260, y: row * 110 },
			data: { node },
			type: "tripwire" as const,
		};
	});
	const edges = definition.edges.map((edge) => ({
		id: edge.id,
		source: edge.from,
		target: edge.to,
		sourceHandle:
			edge.when && HANDLE_WHENS.has(edge.when) ? edge.when : undefined,
		label: edge.when,
	}));
	return { nodes, edges };
}

export type GraphToDefinitionResult =
	| { ok: true; definition: WorkflowDefinition }
	| { ok: false; error: string };

export function graphToDefinition(
	meta: { id: string; name: string; version: number },
	nodes: EditorNode[],
	edges: EditorEdge[],
): GraphToDefinitionResult {
	const candidate = {
		id: meta.id,
		name: meta.name,
		version: meta.version,
		nodes: nodes.map((node) => node.data.node),
		edges: edges.map((edge) => ({
			id: edge.id,
			from: edge.source,
			to: edge.target,
			...(() => {
				const when = handleWhen(edge.sourceHandle) ?? edge.label;
				return when ? { when } : {};
			})(),
		})),
	};
	const parsed = workflowDefinitionSchema.safeParse(candidate);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return {
			ok: false,
			error: `${issue?.path.join(".")}: ${issue?.message}`,
		};
	}
	return { ok: true, definition: parsed.data };
}
