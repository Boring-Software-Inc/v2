import type {
	NodePosition,
	WorkflowDefinition,
	WorkflowNode,
} from "./workflow.ts";

type Graph = Pick<WorkflowDefinition, "nodes" | "edges">;

/** The steps one trigger reaches first, in run order. */
export interface WorkflowLane {
	index: number;
	triggerId: string;
	nodeIds: string[];
}

export interface LayoutSpacing {
	cardWidth: number;
	columnGap: number;
	rowGap: number;
	laneGap: number;
	/** Room above each lane for its title, when there is more than one lane. */
	head: number;
}

/**
 * Lanes by trigger: each trigger owns every step it reaches that an earlier
 * trigger has not claimed. The canvas draws one band per lane.
 */
export function workflowLanes(graph: Graph): WorkflowLane[] {
	const owner = new Map<string, number>();
	const triggers = graph.nodes.filter((node) => node.type === "trigger");
	return triggers.map((trigger, index) => {
		const order: string[] = [];
		const queue = [trigger.id];
		for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
			if (owner.has(id)) {
				continue;
			}
			owner.set(id, index);
			order.push(id);
			for (const edge of graph.edges) {
				if (edge.from === id && !owner.has(edge.to)) {
					queue.push(edge.to);
				}
			}
		}
		return { index, triggerId: trigger.id, nodeIds: order };
	});
}

/** Each lane step's column: the longest path from the lane's trigger. */
export function laneDepths(
	graph: Graph,
	lane: WorkflowLane,
): Map<string, number> {
	const members = new Set(lane.nodeIds);
	const depths = new Map<string, number>();
	const depthOf = (id: string, seen: Set<string>): number => {
		const known = depths.get(id);
		if (known !== undefined) {
			return known;
		}
		if (id === lane.triggerId || seen.has(id)) {
			return 0;
		}
		const next = new Set(seen).add(id);
		const parents = graph.edges.filter(
			(edge) => edge.to === id && members.has(edge.from),
		);
		const depth =
			parents.length === 0
				? 1
				: 1 + Math.max(...parents.map((edge) => depthOf(edge.from, next)));
		depths.set(id, depth);
		return depth;
	};
	for (const id of lane.nodeIds) {
		depths.set(id, depthOf(id, new Set()));
	}
	for (const id of lane.nodeIds) {
		const outgoing = graph.edges.filter((edge) => edge.from === id);
		const gateDepths = outgoing.flatMap((edge) =>
			edge.input === "requirement" ? [depths.get(edge.to) ?? 0] : [],
		);
		const own = depths.get(id) ?? 0;
		if (gateDepths.length > 0 && gateDepths.length === outgoing.length) {
			depths.set(id, Math.max(own, Math.min(...gateDepths) - 1));
		}
	}
	return depths;
}

/**
 * Positions computed from the graph alone: lanes stack top to bottom,
 * columns follow depth, and cards in one column stack by measured height.
 * Steps no trigger reaches go in a row underneath.
 */
export function layoutWorkflow(
	graph: Graph,
	options: {
		spacing: LayoutSpacing;
		heightOf: (node: WorkflowNode) => number;
	},
): Map<string, NodePosition> {
	const { spacing, heightOf } = options;
	const lanes = workflowLanes(graph);
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const placed = new Map<string, NodePosition>();
	const multi = lanes.length > 1;
	const column = spacing.cardWidth + spacing.columnGap;
	let top = 0;
	for (const lane of lanes) {
		const depths = laneDepths(graph, lane);
		const stacks = new Map<number, number>();
		const start = top + (multi ? spacing.head : 0);
		let bottom = start;
		for (const id of lane.nodeIds) {
			const node = byId.get(id);
			if (!node) {
				continue;
			}
			const depth = depths.get(id) ?? 0;
			const y = stacks.get(depth) ?? start;
			placed.set(id, { x: depth * column, y });
			const end = y + heightOf(node);
			stacks.set(depth, end + spacing.rowGap);
			bottom = Math.max(bottom, end);
		}
		top = bottom + spacing.laneGap;
	}
	const bottoms = new Map<number, number>();
	for (const node of graph.nodes) {
		const at = placed.get(node.id);
		if (at) {
			bottoms.set(
				at.x,
				Math.max(bottoms.get(at.x) ?? 0, at.y + heightOf(node)),
			);
		}
	}
	const loose = graph.nodes.filter((node) => !placed.has(node.id));
	let next = 0;
	for (const node of loose) {
		const feeds = graph.edges.find(
			(edge) =>
				edge.from === node.id &&
				edge.input === "exception" &&
				placed.has(edge.to),
		);
		const gate = feeds ? placed.get(feeds.to) : undefined;
		if (gate && gate.x >= column) {
			const x = gate.x - column;
			const y = (bottoms.get(x) ?? gate.y) + spacing.rowGap;
			placed.set(node.id, { x, y });
			bottoms.set(x, y + heightOf(node));
			continue;
		}
		placed.set(node.id, { x: next * column, y: top });
		next++;
	}
	return placed;
}

/**
 * The graph with every node moved to its `layoutWorkflow` position. Only
 * `position` changes, so arranging never changes what a workflow does.
 */
export function arrangeWorkflow<G extends Graph>(
	graph: G,
	options: {
		spacing: LayoutSpacing;
		heightOf: (node: WorkflowNode) => number;
	},
): G {
	const placed = layoutWorkflow(graph, options);
	return {
		...graph,
		nodes: graph.nodes.map((node) => {
			const position = placed.get(node.id);
			return position ? { ...node, position } : node;
		}),
	};
}
