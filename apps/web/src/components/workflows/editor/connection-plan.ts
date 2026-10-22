import type {
	WorkflowNode,
	WorkflowNodeType,
	WorkflowPort,
	WorkflowPortKind,
	WorkflowPortTone,
} from "@tripwire/contracts";
import {
	acceptedPortKinds,
	acceptedPorts,
	acceptReason,
	edgePort,
	outputPorts,
	WORKFLOW_PORT_KIND,
	WORKFLOW_PORT_KIND_LABELS,
	WORKFLOW_PORT_LABELS,
	WORKFLOW_PORT_TONE,
} from "@tripwire/contracts";
import { handleWhen } from "#/lib/workflow-editor";

export type PortShape = WorkflowPortKind | "any";

export interface PortLook {
	shape: PortShape;
	tone: WorkflowPortTone;
}

export const SELF_REASON = "A step cannot connect to itself";
export const NO_OUTPUTS_REASON = "This step has no outputs";

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
	reason: string | null;
}

export interface NodeVerdict {
	origin: boolean;
	handles: HandleVerdict[];
	reason: string | null;
}

export interface DragPlan {
	direction: "out" | "in";
	port: WorkflowPort | null;
	verdicts: ReadonlyMap<string, NodeVerdict>;
}

function nodeVerdict(handles: HandleVerdict[], empty: string): NodeVerdict {
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
				verdicts.set(node.id, {
					origin: true,
					handles: [{ handleId: null, reason: SELF_REASON }],
					reason: SELF_REASON,
				});
				continue;
			}
			const reason = acceptReason(node.type, port);
			verdicts.set(node.id, nodeVerdict([{ handleId: null, reason }], ""));
		}
		return { direction: "out", port, verdicts };
	}
	for (const node of nodes) {
		if (node.id === from.id) {
			verdicts.set(node.id, {
				origin: true,
				handles: outputPorts(node).map((port) => ({
					handleId: portHandleId(port),
					reason: SELF_REASON,
				})),
				reason: SELF_REASON,
			});
			continue;
		}
		const handles = outputPorts(node).map((port) => ({
			handleId: portHandleId(port),
			reason: acceptReason(from.type, port),
		}));
		verdicts.set(node.id, nodeVerdict(handles, NO_OUTPUTS_REASON));
	}
	return { direction: "in", port: null, verdicts };
}

export function handleReason(
	verdict: NodeVerdict | undefined,
	handleId: string | null | undefined,
): string | null {
	if (!verdict) {
		return null;
	}
	const handle = verdict.handles.find(
		(entry) => entry.handleId === (handleId ?? null),
	);
	return handle ? handle.reason : verdict.reason;
}
