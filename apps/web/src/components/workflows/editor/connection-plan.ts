import type {
	ConnectionHint,
	WorkflowNode,
	WorkflowNodeType,
	WorkflowPort,
	WorkflowPortKind,
	WorkflowPortTone,
} from "@tripwire/contracts";
import {
	acceptedPortKinds,
	acceptedPorts,
	edgePort,
	outputPorts,
	portHint,
	stepDisplayName,
	WORKFLOW_PORT_KIND,
	WORKFLOW_PORT_KIND_LABELS,
	WORKFLOW_PORT_LABELS,
	WORKFLOW_PORT_TONE,
} from "@tripwire/contracts";
import {
	getBezierPath,
	getStraightPath,
	Position,
	type XYPosition,
} from "@xyflow/react";
import { handleWhen } from "#/lib/workflow-editor";

export type PortShape = WorkflowPortKind | "any";

export interface PortLook {
	shape: PortShape;
	tone: WorkflowPortTone;
}

export function selfHint(name: string): ConnectionHint {
	return { rule: "cycle", message: `${name} cannot connect to itself` };
}

export function noOutputsHint(name: string): ConnectionHint {
	return { rule: "no-outputs", message: `${name} has no outputs` };
}

export function portHandleId(port: WorkflowPort): string | null {
	return port === "event" || port === "pass" ? null : port;
}

export function handlePort(
	node: WorkflowNode,
	handleId: string | null | undefined,
): WorkflowPort {
	return edgePort(node, handleWhen(handleId));
}

export function outputLook(port: WorkflowPort): PortLook {
	return { shape: WORKFLOW_PORT_KIND[port], tone: WORKFLOW_PORT_TONE[port] };
}

export function inputLook(type: WorkflowNodeType): PortLook | null {
	const ports = acceptedPorts(type);
	const kinds = acceptedPortKinds(type);
	const [kind] = kinds;
	if (!kind) {
		return null;
	}
	return {
		shape: kinds.length === 1 ? kind : "any",
		tone: sharedTone(ports),
	};
}

const ALL_PORTS: readonly WorkflowPort[] = [
	"event",
	"pass",
	"fail",
	"approve",
	"deny",
];

function sharedTone(ports: readonly WorkflowPort[]): WorkflowPortTone {
	const tones = new Set(ports.map((port) => WORKFLOW_PORT_TONE[port]));
	const [tone] = tones;
	return tones.size === 1 && tone ? tone : "neutral";
}

export function inputSummary(
	type: WorkflowNodeType,
): { look: PortLook; label: string }[] {
	const ports = acceptedPorts(type);
	return acceptedPortKinds(type).map((kind) => {
		const taken = ports.filter((port) => WORKFLOW_PORT_KIND[port] === kind);
		const whole = ALL_PORTS.filter((port) => WORKFLOW_PORT_KIND[port] === kind);
		return {
			look: { shape: kind, tone: sharedTone(taken) },
			label:
				taken.length === whole.length
					? WORKFLOW_PORT_KIND_LABELS[kind]
					: taken.map((port) => WORKFLOW_PORT_LABELS[port]).join(", "),
		};
	});
}

export interface DragOrigin {
	nodeId: string;
	handleId: string | null;
	handleType: "source" | "target";
}

export interface HandleVerdict {
	handleId: string | null;
	reason: ConnectionHint | null;
}

export interface NodeVerdict {
	origin: boolean;
	handles: HandleVerdict[];
	reason: ConnectionHint | null;
}

export interface DragPlan {
	direction: "out" | "in";
	port: WorkflowPort | null;
	verdicts: ReadonlyMap<string, NodeVerdict>;
}

function nodeVerdict(
	handles: HandleVerdict[],
	empty: ConnectionHint | null,
): NodeVerdict {
	const open = handles.some((handle) => handle.reason === null);
	return {
		origin: false,
		handles,
		reason: open ? null : (handles[0]?.reason ?? empty),
	};
}

export function planDrag(
	origin: DragOrigin,
	nodes: readonly WorkflowNode[],
	name: (node: WorkflowNode) => string = (node) => stepDisplayName(node),
): DragPlan | null {
	const from = nodes.find((node) => node.id === origin.nodeId);
	if (!from) {
		return null;
	}
	const verdicts = new Map<string, NodeVerdict>();
	if (origin.handleType === "source") {
		const port = handlePort(from, origin.handleId);
		for (const node of nodes) {
			if (node.id === from.id) {
				const self = selfHint(name(node));
				verdicts.set(node.id, {
					origin: true,
					handles: [{ handleId: null, reason: self }],
					reason: self,
				});
				continue;
			}
			const reason = portHint(node, port, name(node));
			verdicts.set(node.id, nodeVerdict([{ handleId: null, reason }], null));
		}
		return { direction: "out", port, verdicts };
	}
	for (const node of nodes) {
		if (node.id === from.id) {
			const self = selfHint(name(node));
			verdicts.set(node.id, {
				origin: true,
				handles: outputPorts(node).map((port) => ({
					handleId: portHandleId(port),
					reason: self,
				})),
				reason: self,
			});
			continue;
		}
		const handles = outputPorts(node).map((port) => ({
			handleId: portHandleId(port),
			reason: portHint(from, port, name(from)),
		}));
		verdicts.set(node.id, nodeVerdict(handles, noOutputsHint(name(node))));
	}
	return { direction: "in", port: null, verdicts };
}

export function handleReason(
	verdict: NodeVerdict | undefined,
	handleId: string | null | undefined,
): ConnectionHint | null {
	if (!verdict) {
		return null;
	}
	const handle = verdict.handles.find(
		(entry) => entry.handleId === (handleId ?? null),
	);
	return handle ? handle.reason : verdict.reason;
}

const STRAIGHT_BAND = 24;
const PREVIEW_LEAD = 32;

export function previewSides(
	from: XYPosition,
	to: XYPosition,
): { sourcePosition: Position; targetPosition: Position } | null {
	if (to.x >= from.x) {
		return { sourcePosition: Position.Right, targetPosition: Position.Left };
	}
	if (Math.abs(to.y - from.y) < STRAIGHT_BAND) {
		return null;
	}
	return {
		sourcePosition: Position.Right,
		targetPosition: to.y > from.y ? Position.Top : Position.Bottom,
	};
}

export function previewPath(from: XYPosition, to: XYPosition): string {
	const sides = previewSides(from, to);
	const ends = {
		sourceX: from.x,
		sourceY: from.y,
		targetX: to.x,
		targetY: to.y,
	};
	if (!sides) {
		return getStraightPath(ends)[0];
	}
	if (sides.targetPosition === Position.Left) {
		return getBezierPath({ ...ends, ...sides })[0];
	}
	const lead = Math.min(PREVIEW_LEAD, from.x - to.x);
	const bend = to.y - (to.y - from.y) / 2;
	return `M${from.x},${from.y} C${from.x + lead},${from.y} ${to.x},${bend} ${to.x},${to.y}`;
}
