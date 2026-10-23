import {
	type LayoutSpacing,
	layoutWorkflow,
	type WorkflowDefinition,
	type WorkflowNode,
	workflowLanes,
} from "@tripwire/contracts";
import {
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";
import { scheduleShortSummary } from "#/lib/schedule-summary";
import { triggerPath, whenSentence } from "#/lib/trigger-kinds";

type Graph = Pick<WorkflowDefinition, "nodes" | "edges">;

export const LANE_SPACING: LayoutSpacing = {
	cardWidth: 224,
	columnGap: 96,
	rowGap: 24,
	laneGap: 112,
	head: 40,
};

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
	return layoutWorkflow(graph, { spacing: LANE_SPACING, heightOf });
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
