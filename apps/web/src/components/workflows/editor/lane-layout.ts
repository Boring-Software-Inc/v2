import {
	type LayoutSpacing,
	layoutWorkflow,
	outputPorts,
	scheduleShortSummary,
	type WorkflowDefinition,
	type WorkflowNode,
	workflowLanes,
} from "@tripwire/contracts";
import {
	nodeFieldValues,
	summarizeFieldValue,
} from "#/components/workflows/editor/node-fields";
import { ruleGroupsView } from "#/lib/rule-groups";
import { triggerPath, whenSentence } from "#/lib/trigger-kinds";

type Graph = Pick<WorkflowDefinition, "nodes" | "edges">;

export const LANE_SPACING: LayoutSpacing = {
	cardWidth: 224,
	columnGap: 96,
	rowGap: 24,
	laneGap: 112,
	head: 40,
};

const CARD = {
	head: 36,
	detail: 16,
	outcome: 17,
	fields: 13,
	rowMin: 28,
	rowPad: 8,
	line: 16,
	rowWidth: 196,
	char: 7,
	labelGap: 12,
};

function textLines(text: string, width: number): number {
	const perLine = Math.max(1, Math.floor(width / CARD.char));
	return Math.max(1, Math.ceil(text.length / perLine));
}

export function estimateCardHeight(node: WorkflowNode): number {
	const detail = node.type === "rule" || node.type === "gate";
	const outcome = outputPorts(node).length > 1;
	const rows = nodeFieldValues(node);
	const body = rows.reduce((sum, { field, value }) => {
		const text = summarizeFieldValue(field, value);
		const bare = field.key === "message" && value !== undefined;
		const width = bare
			? CARD.rowWidth
			: CARD.rowWidth - field.label.length * CARD.char - CARD.labelGap;
		const lines = textLines(text, width);
		return sum + Math.max(CARD.rowMin, CARD.rowPad + lines * CARD.line);
	}, 0);
	return (
		CARD.head +
		(detail ? CARD.detail : 0) +
		(rows.length > 0 ? CARD.fields + body : 0) +
		(outcome ? CARD.outcome : 0)
	);
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
	heads: { id: string; index: number; x: number; y: number; label: string }[];
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
			id: bound.lane.triggerId,
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

const GROUP = { head: 44, row: 28, actions: 36 };

export function cardHeightOf(graph: Graph): (node: WorkflowNode) => number {
	const view = ruleGroupsView(graph);
	return (node) => {
		const card = view.cards.get(node.id);
		if (card?.kind === "group") {
			return GROUP.head + card.ruleIds.length * GROUP.row + GROUP.actions;
		}
		if (card?.kind === "skip") {
			const mode = card.checkIds.length > 1 ? GROUP.row + 4 : 0;
			return (
				GROUP.head + mode + card.checkIds.length * GROUP.row + GROUP.actions
			);
		}
		return estimateCardHeight(node);
	};
}

export function placeUnpositioned<
	T extends { id: string; position: { x: number; y: number } },
>(nodes: T[], definition: Graph, full: Graph = definition): T[] {
	if (definition.nodes.every((node) => node.position)) {
		return nodes;
	}
	const layout = laneLayout(definition, cardHeightOf(full));
	const stored = new Set(
		definition.nodes.filter((node) => node.position).map((node) => node.id),
	);
	return nodes.map((node) =>
		stored.has(node.id)
			? node
			: { ...node, position: layout.get(node.id) ?? node.position },
	);
}
