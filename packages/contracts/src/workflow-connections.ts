import { z } from "zod";
import type {
	EdgeWhen,
	GateMode,
	WorkflowActionKind,
	WorkflowNode,
} from "./workflow.ts";

export type WorkflowNodeType = WorkflowNode["type"];

export const workflowPortSchema = z.enum([
	"event",
	"pass",
	"fail",
	"approve",
	"deny",
]);
export type WorkflowPort = z.infer<typeof workflowPortSchema>;

/**
 * The value a port carries. A connection is legal when the target accepts the
 * type the port emits, and nothing else.
 */
export const portTypeSchema = z.enum(["event", "result", "decision"]);
export type PortType = z.infer<typeof portTypeSchema>;

/**
 * How a port derives its value from its node's outcome. The set is closed:
 * users compose ports, they never define new functions.
 */
export const portFnSchema = z.enum(["identity", "not"]);
export type PortFn = z.infer<typeof portFnSchema>;

/** Kept for the canvas: `kind` is the port type under its older name. */
export type WorkflowPortKind = PortType;

export type WorkflowPortTone = "neutral" | "ok" | "fail";

export interface PortSpec {
	type: PortType;
	fn: PortFn;
	label: string;
}

/**
 * The one table of output ports. `fail` is `not(pass)` and `deny` is
 * `not(approve)`: each negated port emits the same type as its plain twin, so
 * it is accepted wherever the plain port is.
 */
export const WORKFLOW_PORTS = {
	event: { type: "event", fn: "identity", label: "Event" },
	pass: { type: "result", fn: "identity", label: "Passes" },
	fail: { type: "result", fn: "not", label: "Doesn't pass" },
	approve: { type: "decision", fn: "identity", label: "Approved" },
	deny: { type: "decision", fn: "not", label: "Blocked" },
} as const satisfies Record<WorkflowPort, PortSpec>;

const FN_SIGNATURE = {
	identity: { event: "event", result: "result", decision: "decision" },
	not: { result: "result", decision: "decision" },
} as const satisfies Record<PortFn, Partial<Record<PortType, PortType>>>;

/**
 * The type `fn` returns for an input of `type`, or null when `fn` is not
 * defined for it. Every defined pair maps a type to itself, which is the
 * "accept x, accept fn(x): x, refuse fn(x): y" invariant.
 */
export function portFnCodomain(fn: PortFn, type: PortType): PortType | null {
	const signature: Partial<Record<PortType, PortType>> = FN_SIGNATURE[fn];
	return signature[type] ?? null;
}

/** The type a port emits after its function is applied. */
export function portType(port: WorkflowPort): PortType | null {
	const spec = WORKFLOW_PORTS[port];
	return portFnCodomain(spec.fn, spec.type);
}

/** Applies a port's function to the outcome of the node it leaves. */
export function applyPort(
	port: WorkflowPort,
	outcome: "pass" | "fail",
): "pass" | "fail" {
	if (WORKFLOW_PORTS[port].fn === "identity") {
		return outcome;
	}
	return outcome === "pass" ? "fail" : "pass";
}

/**
 * A node's settled value. `skipped` is unknown: a rule that could not
 * evaluate, or a gate whose answer hangs on one. Unknown values conduct on no
 * port, so a rule that cannot run never fires an action, through any number
 * of negations.
 */
export type NodeOutcome = "pass" | "fail" | "skipped";

/** The value a node's outcome carries out of `port`. */
export function portValue(
	port: WorkflowPort,
	outcome: NodeOutcome,
): NodeOutcome {
	return outcome === "skipped" ? "skipped" : applyPort(port, outcome);
}

/**
 * Kleene three-valued folds over the inputs that ran. An unknown input
 * decides a gate only when the known inputs leave the answer open.
 */
export function foldGate(
	mode: GateMode,
	inputs: readonly NodeOutcome[],
): NodeOutcome {
	if (mode === "unless") {
		const [requirement, exception] = inputs;
		return foldUnless(requirement, exception).outcome;
	}
	if (mode === "not") {
		const [only] = inputs;
		if (only === undefined || only === "skipped") {
			return "skipped";
		}
		return only === "pass" ? "fail" : "pass";
	}
	const decisive = mode === "all-of" ? "fail" : "pass";
	if (inputs.includes(decisive)) {
		return decisive;
	}
	if (inputs.length === 0 || inputs.includes("skipped")) {
		return "skipped";
	}
	return decisive === "fail" ? "pass" : "fail";
}

export interface UnlessFold {
	outcome: NodeOutcome;
	exceptionApplied: boolean;
}

export function foldUnless(
	requirement: NodeOutcome | undefined,
	exception: NodeOutcome | undefined,
): UnlessFold {
	if (requirement === "pass") {
		return { outcome: "pass", exceptionApplied: false };
	}
	if (exception === "pass") {
		return { outcome: "pass", exceptionApplied: requirement === "fail" };
	}
	return { outcome: requirement ?? "skipped", exceptionApplied: false };
}

export const WORKFLOW_PORT_LABELS = {
	event: WORKFLOW_PORTS.event.label,
	pass: WORKFLOW_PORTS.pass.label,
	fail: WORKFLOW_PORTS.fail.label,
	approve: WORKFLOW_PORTS.approve.label,
	deny: WORKFLOW_PORTS.deny.label,
} satisfies Record<WorkflowPort, string>;

export const WORKFLOW_PORT_KIND = {
	event: WORKFLOW_PORTS.event.type,
	pass: WORKFLOW_PORTS.pass.type,
	fail: WORKFLOW_PORTS.fail.type,
	approve: WORKFLOW_PORTS.approve.type,
	deny: WORKFLOW_PORTS.deny.type,
} satisfies Record<WorkflowPort, PortType>;

export const WORKFLOW_PORT_KIND_LABELS = {
	event: "Events",
	result: "Results",
	decision: "Decisions",
} satisfies Record<PortType, string>;

export function portTone(port: WorkflowPort): WorkflowPortTone {
	const spec = WORKFLOW_PORTS[port];
	if (spec.type === "event") {
		return "neutral";
	}
	return spec.fn === "not" ? "fail" : "ok";
}

export const WORKFLOW_PORT_TONE = {
	event: portTone("event"),
	pass: portTone("pass"),
	fail: portTone("fail"),
	approve: portTone("approve"),
	deny: portTone("deny"),
} satisfies Record<WorkflowPort, WorkflowPortTone>;

/** What each node type's input accepts, by type. */
export const WORKFLOW_INPUTS = {
	trigger: [],
	rule: ["event", "result", "decision"],
	gate: ["result"],
	action: ["event", "result", "decision"],
} as const satisfies Record<WorkflowNodeType, readonly PortType[]>;

/** Actions with outputs. Every other action is a sink. */
export const ACTION_OUTPUTS = {
	"send-to-moderation": ["approve", "deny"],
} as const satisfies Partial<
	Record<WorkflowActionKind, readonly WorkflowPort[]>
>;

const EVERY_PORT = workflowPortSchema.options;

/** Accepted types for a node type's input. */
export function acceptedTypes(target: WorkflowNodeType): readonly PortType[] {
	return WORKFLOW_INPUTS[target];
}

export function canAccept(
	target: WorkflowNodeType,
	port: WorkflowPort,
): boolean {
	const type = portType(port);
	return type !== null && acceptedTypes(target).includes(type);
}

/** Every port a node type's input accepts, derived from the type rule. */
export function acceptedPorts(
	target: WorkflowNodeType,
): readonly WorkflowPort[] {
	return EVERY_PORT.filter((port) => canAccept(target, port));
}

export const WORKFLOW_CONNECTIONS = {
	trigger: { accepts: acceptedPorts("trigger") },
	rule: { accepts: acceptedPorts("rule") },
	gate: { accepts: acceptedPorts("gate") },
	action: { accepts: acceptedPorts("action") },
} satisfies Record<WorkflowNodeType, { accepts: readonly WorkflowPort[] }>;

export function acceptedPortKinds(
	target: WorkflowNodeType,
): readonly PortType[] {
	return acceptedTypes(target);
}

const NODE_PLURALS = {
	trigger: "Triggers",
	rule: "Rules",
	gate: "Gates",
	action: "Actions",
} satisfies Record<WorkflowNodeType, string>;

export function acceptReason(
	target: WorkflowNodeType,
	port: WorkflowPort,
): string | null {
	if (canAccept(target, port)) {
		return null;
	}
	const plural = NODE_PLURALS[target];
	const types = acceptedTypes(target);
	if (types.length === 0) {
		return `${plural} take no inputs`;
	}
	const taken = types
		.map((type) => WORKFLOW_PORT_KIND_LABELS[type].toLowerCase())
		.join(" or ");
	const given = WORKFLOW_PORT_KIND_LABELS[WORKFLOW_PORTS[port].type];
	return `${plural} take ${taken}, not ${given.toLowerCase()}`;
}

export function outputPorts(node: WorkflowNode): readonly WorkflowPort[] {
	switch (node.type) {
		case "trigger":
			return ["event"];
		case "rule":
		case "gate":
			return ["pass", "fail"];
		case "action":
			return node.action === "send-to-moderation"
				? ACTION_OUTPUTS[node.action]
				: [];
		default:
			return [];
	}
}

export function edgePort(
	source: WorkflowNode,
	when: EdgeWhen | undefined,
): WorkflowPort {
	if (source.type === "trigger" && (when === undefined || when === "pass")) {
		return "event";
	}
	return when ?? "pass";
}

/** The stored edge `when` for a port. Plain outputs store no `when`. */
export function portWhen(port: WorkflowPort): EdgeWhen | undefined {
	return port === "event" || port === "pass" ? undefined : port;
}

export interface ConnectionIssue {
	on: "source" | "target";
	message: string;
}

export function connectionIssue(
	source: WorkflowNode,
	target: WorkflowNode,
	when: EdgeWhen | undefined,
): ConnectionIssue | null {
	const outputs = outputPorts(source);
	if (outputs.length === 0) {
		return {
			on: "source",
			message: "only Human review steps have outputs",
		};
	}
	const port = edgePort(source, when);
	if (!outputs.includes(port)) {
		return {
			on: "source",
			message:
				port === "approve" || port === "deny"
					? "Approved and Blocked edges may only leave Human review"
					: `${source.type === "action" ? "Human review" : source.type} has no ${WORKFLOW_PORT_LABELS[port].toLowerCase()} output`,
		};
	}
	const reason = acceptReason(target.type, port);
	return reason ? { on: "target", message: reason } : null;
}
