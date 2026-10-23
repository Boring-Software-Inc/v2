import { edgeWhenSchema, type WorkflowNode } from "./workflow.ts";
import {
	acceptedPorts,
	acceptedTypes,
	edgePort,
	outputPorts,
	type PortType,
	portTone,
	portWhen,
	WORKFLOW_PORT_KIND_LABELS,
	WORKFLOW_PORT_LABELS,
	WORKFLOW_PORTS,
	type WorkflowNodeType,
	type WorkflowPort,
	type WorkflowPortTone,
	workflowPortSchema,
} from "./workflow-connections.ts";
import {
	type ConnectionHint,
	portHint,
	stepDisplayName,
} from "./workflow-lint.ts";

/**
 * What the canvas draws for ports and connections, computed from the type
 * rules before anything renders. The canvas holds no connection rules: every
 * "can connect" and every reason comes from here.
 */

export type PortShape = PortType | "any";

export interface PortLook {
	/** The type the port carries, or `any` for an input taking several. */
	shape: PortShape;
	tone: WorkflowPortTone;
	/** True for `fail` and `deny`: the plain port's value, negated. */
	negated: boolean;
}

export function selfHint(name: string): ConnectionHint {
	return { rule: "cycle", message: `${name} cannot connect to itself` };
}

export function noOutputsHint(name: string): ConnectionHint {
	return { rule: "no-outputs", message: `${name} has no outputs` };
}

/** The canvas handle id for a port. Plain outputs use the default handle. */
export function portHandleId(port: WorkflowPort): string | null {
	return portWhen(port) ?? null;
}

/** The port a canvas handle stands for on a node. */
export function handlePort(
	node: WorkflowNode,
	handleId: string | null | undefined,
): WorkflowPort {
	const when = edgeWhenSchema.safeParse(handleId);
	return edgePort(node, when.success ? when.data : undefined);
}

export function outputLook(port: WorkflowPort): PortLook {
	const spec = WORKFLOW_PORTS[port];
	return {
		shape: spec.type,
		tone: portTone(port),
		negated: spec.fn === "not",
	};
}

function sharedTone(ports: readonly WorkflowPort[]): WorkflowPortTone {
	const tones = new Set(ports.map(portTone));
	const [tone] = tones;
	return tones.size === 1 && tone ? tone : "neutral";
}

export function inputLook(type: WorkflowNodeType): PortLook | null {
	const types = acceptedTypes(type);
	const [first] = types;
	if (!first) {
		return null;
	}
	return {
		shape: types.length === 1 ? first : "any",
		tone: sharedTone(acceptedPorts(type)),
		negated: false,
	};
}

/** One entry per type an input takes, labelled for people. */
export function inputSummary(
	type: WorkflowNodeType,
): { look: PortLook; label: string }[] {
	const ports = acceptedPorts(type);
	return acceptedTypes(type).map((kind) => {
		const taken = ports.filter((port) => WORKFLOW_PORTS[port].type === kind);
		const whole = workflowPortSchema.options.filter(
			(port) => WORKFLOW_PORTS[port].type === kind,
		);
		return {
			look: { shape: kind, tone: sharedTone(taken), negated: false },
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

/**
 * For a drag from one handle, every other node's verdict: which of its
 * handles take the connection, and why the rest refuse it.
 */
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
