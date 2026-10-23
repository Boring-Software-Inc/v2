import type { WorkflowDefinition, WorkflowNode } from "@tripwire/contracts";
import {
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";
import { scheduleShortSummary } from "#/lib/schedule-summary";
import { triggerPath, whenSentence } from "#/lib/trigger-kinds";

type Graph = Pick<WorkflowDefinition, "nodes" | "edges">;

export interface WorkflowLane {
	index: number;
	triggerId: string;
	nodeIds: string[];
}

export const LANE_SPACING = {
	cardWidth: 224,
	columnGap: 96,
	rowGap: 24,
	laneGap: 112,
	head: 40,
};

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

function laneDepths(graph: Graph, lane: WorkflowLane): Map<string, number> {
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
	return depths;
}

const LABELED_CHARS = 22;
const BARE_CHARS = 30;

export function estimateCardHeight(node: WorkflowNode): number {
	const rows = nodeFieldValues(node);
	if (rows.length === 0) {
		return 44;
	}
	const body = rows.reduce((sum, { field, value }) => {
		const text = summarizeFieldValue(field, value);
		const perLine =
			field.key === "message" && value !== undefined
				? BARE_CHARS
				: LABELED_CHARS;
		const lines = Math.max(1, Math.ceil(text.length / perLine));
		return sum + Math.max(28, 8 + lines * 17);
	}, 0);
	return 44 + 12 + body;
}

export function laneLayout(
	graph: Graph,
	heightOf: (node: WorkflowNode) => number = estimateCardHeight,
): Map<string, { x: number; y: number }> {
	const lanes = workflowLanes(graph);
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const placed = new Map<string, { x: number; y: number }>();
	const multi = lanes.length > 1;
	const column = LANE_SPACING.cardWidth + LANE_SPACING.columnGap;
	let top = 0;
	for (const lane of lanes) {
		const depths = laneDepths(graph, lane);
		const stacks = new Map<number, number>();
		const start = top + (multi ? LANE_SPACING.head : 0);
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
			stacks.set(depth, end + LANE_SPACING.rowGap);
			bottom = Math.max(bottom, end);
		}
		top = bottom + LANE_SPACING.laneGap;
	}
	const loose = graph.nodes.filter((node) => !placed.has(node.id));
	loose.forEach((node, index) => {
		placed.set(node.id, { x: index * column, y: top });
	});
	return placed;
}

export function laneSummary(node: WorkflowNode): string {
	if (node.type !== "trigger") {
		return "";
	}
	if (triggerPath(node) === "schedule") {
		return scheduleShortSummary(node.schedule);
	}
	return whenSentence(node.kinds) ?? "Event not set";
}

export interface LaneBox {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LaneDecor {
	heads: { index: number; x: number; y: number; label: string }[];
	rules: { y: number; x: number; width: number }[];
}

export function laneDecor(graph: Graph, boxes: readonly LaneBox[]): LaneDecor {
	const lanes = workflowLanes(graph);
	if (lanes.length < 2) {
		return { heads: [], rules: [] };
	}
	const boxOf = new Map(boxes.map((box) => [box.id, box]));
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const bounds = lanes.flatMap((lane) => {
		const members = lane.nodeIds.flatMap((id) => {
			const box = boxOf.get(id);
			return box ? [box] : [];
		});
		if (members.length === 0) {
			return [];
		}
		return [
			{
				lane,
				left: Math.min(...members.map((box) => box.x)),
				right: Math.max(...members.map((box) => box.x + box.width)),
				top: Math.min(...members.map((box) => box.y)),
				bottom: Math.max(...members.map((box) => box.y + box.height)),
			},
		];
	});
	const left = Math.min(...bounds.map((bound) => bound.left)) - 48;
	const right = Math.max(...bounds.map((bound) => bound.right)) + 48;
	const heads = bounds.map((bound) => {
		const trigger = byId.get(bound.lane.triggerId);
		return {
			index: bound.lane.index + 1,
			x: bound.left,
			y: bound.top - LANE_SPACING.head + 8,
			label: trigger ? laneSummary(trigger) : "",
		};
	});
	const rules = bounds.slice(1).map((bound, index) => {
		const above = bounds[index];
		const headTop = bound.top - LANE_SPACING.head + 8;
		return {
			x: left,
			width: right - left,
			y: Math.round(((above?.bottom ?? headTop) + headTop) / 2),
		};
	});
	return { heads, rules };
}

export function placeUnpositioned<
	T extends { id: string; position: { x: number; y: number } },
>(nodes: T[], definition: Graph): T[] {
	if (definition.nodes.every((node) => node.position)) {
		return nodes;
	}
	const layout = laneLayout(definition);
	const stored = new Set(
		definition.nodes.filter((node) => node.position).map((node) => node.id),
	);
	return nodes.map((node) =>
		stored.has(node.id)
			? node
			: { ...node, position: layout.get(node.id) ?? node.position },
	);
}
