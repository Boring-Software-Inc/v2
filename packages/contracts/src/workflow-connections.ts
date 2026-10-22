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

export const WORKFLOW_INPUT_LABELS = {
	trigger: null,
	rule: "Event or step result",
	gate: "Rule or gate results",
	action: "Event or step result",
} satisfies Record<WorkflowNodeType, string | null>;

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
	if (target.type === "trigger") {
		return { on: "target", message: "trigger cannot have inputs" };
	}
	const outputs = outputPorts(source);
	if (outputs.length === 0) {
		return {
			on: "source",
			message: "only send-to-moderation actions may have outputs",
		};
	}
	const port = edgePort(source, when);
	if (!outputs.includes(port)) {
		return {
			on: "source",
			message:
				port === "approve" || port === "deny"
					? "approve/deny edges may only leave send-to-moderation"
					: `${source.type === "action" ? "send-to-moderation" : source.type} has no ${WORKFLOW_PORT_LABELS[port].toLowerCase()} output`,
		};
	}
	const accepted: readonly WorkflowPort[] =
		WORKFLOW_CONNECTIONS[target.type].accepts;
	if (accepted.includes(port)) {
		return null;
	}
	if (port === "event") {
		return {
			on: "target",
			message:
				"a gate combines rule results, not trigger events. Connect the trigger to a rule first",
		};
	}
	if (port === "fail") {
		return {
			on: "target",
			message:
				"a gate reads each input's own result. Connect it from the passes output",
		};
	}
	return {
		on: "target",
		message: "a gate combines rule results, not moderation decisions",
	};
}
