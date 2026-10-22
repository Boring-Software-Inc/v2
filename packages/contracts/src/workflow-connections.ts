import type { EdgeWhen, WorkflowNode } from "./workflow.ts";

export type WorkflowNodeType = WorkflowNode["type"];

export type WorkflowPort = "event" | "pass" | "fail" | "approve" | "deny";

export const WORKFLOW_PORT_LABELS = {
	event: "Event",
	pass: "Passes",
	fail: "Doesn't pass",
	approve: "Approved",
	deny: "Blocked",
} satisfies Record<WorkflowPort, string>;

const EVERY_PORT: readonly WorkflowPort[] = [
	"event",
	"pass",
	"fail",
	"approve",
	"deny",
];

export const WORKFLOW_CONNECTIONS = {
	trigger: { accepts: [] },
	rule: { accepts: EVERY_PORT },
	gate: { accepts: ["pass"] },
	action: { accepts: EVERY_PORT },
} satisfies Record<WorkflowNodeType, { accepts: readonly WorkflowPort[] }>;

export type WorkflowPortKind = "event" | "result" | "decision";

export const WORKFLOW_PORT_KIND = {
	event: "event",
	pass: "result",
	fail: "result",
	approve: "decision",
	deny: "decision",
} satisfies Record<WorkflowPort, WorkflowPortKind>;

export const WORKFLOW_PORT_KIND_LABELS = {
	event: "Events",
	result: "Results",
	decision: "Decisions",
} satisfies Record<WorkflowPortKind, string>;

export type WorkflowPortTone = "neutral" | "ok" | "fail";

export const WORKFLOW_PORT_TONE = {
	event: "neutral",
	pass: "ok",
	fail: "fail",
	approve: "ok",
	deny: "fail",
} satisfies Record<WorkflowPort, WorkflowPortTone>;

const NODE_PLURALS = {
	trigger: "Triggers",
	rule: "Rules",
	gate: "Gates",
	action: "Actions",
} satisfies Record<WorkflowNodeType, string>;

export function acceptedPorts(
	target: WorkflowNodeType,
): readonly WorkflowPort[] {
	return WORKFLOW_CONNECTIONS[target].accepts;
}

export function acceptedPortKinds(
	target: WorkflowNodeType,
): readonly WorkflowPortKind[] {
	return [...new Set(acceptedPorts(target).map((p) => WORKFLOW_PORT_KIND[p]))];
}

export function canAccept(
	target: WorkflowNodeType,
	port: WorkflowPort,
): boolean {
	return acceptedPorts(target).includes(port);
}

export function acceptReason(
	target: WorkflowNodeType,
	port: WorkflowPort,
): string | null {
	if (canAccept(target, port)) {
		return null;
	}
	const plural = NODE_PLURALS[target];
	const kinds = acceptedPortKinds(target);
	if (kinds.length === 0) {
		return `${plural} take no inputs`;
	}
	const kind = WORKFLOW_PORT_KIND[port];
	if (!kinds.includes(kind)) {
		const taken = kinds
			.map((k) => WORKFLOW_PORT_KIND_LABELS[k].toLowerCase())
			.join(" or ");
		return `${plural} take ${taken}, not ${WORKFLOW_PORT_KIND_LABELS[kind].toLowerCase()}`;
	}
	const labels = acceptedPorts(target)
		.filter((p) => WORKFLOW_PORT_KIND[p] === kind)
		.map((p) => WORKFLOW_PORT_LABELS[p])
		.join(" or ");
	return `${plural} take only the ${labels} result`;
}

export function outputPorts(node: WorkflowNode): readonly WorkflowPort[] {
	switch (node.type) {
		case "trigger":
			return ["event"];
		case "rule":
		case "gate":
			return ["pass", "fail"];
		case "action":
			return node.action === "send-to-moderation" ? ["approve", "deny"] : [];
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
