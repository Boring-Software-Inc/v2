import type {
	JsonValue,
	WorkflowDefinition,
	WorkflowEdge,
	WorkflowNode,
} from "./workflow.ts";
import { edgePort, WORKFLOW_PORT_LABELS } from "./workflow-connections.ts";

/** Params that hold secrets, and the markers that say one is stored. */
export const WORKFLOW_SECRET_KEYS: ReadonlySet<string> = new Set([
	"url",
	"signingSecret",
	"urlSet",
	"signingSecretSet",
]);

const SECRET_KEYS = WORKFLOW_SECRET_KEYS;

function isDeliveryNode(
	node: WorkflowNode,
): node is Extract<WorkflowNode, { type: "action" }> {
	return (
		node.type === "action" &&
		(node.action === "webhook" || node.action === "discord")
	);
}

/**
 * Blanks stored delivery secrets and marks which were set, for anything that
 * leaves the server. The full value never does.
 */
export function redactWorkflowSecrets(
	definition: WorkflowDefinition,
): WorkflowDefinition {
	return {
		...definition,
		nodes: definition.nodes.map((node) => {
			if (!isDeliveryNode(node)) {
				return node;
			}
			const params = { ...(node.params ?? {}) };
			for (const key of ["url", "signingSecret"]) {
				const value = params[key];
				if (value !== undefined && value !== "" && value !== null) {
					params[key] = "";
					params[`${key}Set`] = true;
				}
			}
			return { ...node, params };
		}),
	};
}

/** Drops every secret param, for definitions that arrive as code. */
export function stripWorkflowSecrets(
	definition: WorkflowDefinition,
): WorkflowDefinition {
	return {
		...definition,
		nodes: definition.nodes.map((node) => {
			if (!(isDeliveryNode(node) && node.params)) {
				return node;
			}
			const params = Object.fromEntries(
				Object.entries(node.params).filter(([key]) => !SECRET_KEYS.has(key)),
			);
			const { params: _dropped, ...rest } = node;
			return Object.keys(params).length > 0 ? { ...rest, params } : rest;
		}),
	};
}

export interface WorkflowChange {
	change: "added" | "removed" | "changed";
	subject: "workflow" | "step" | "connection";
	id: string;
	text: string;
}

function comparable(node: WorkflowNode): string {
	const { position: _position, ...rest } = node;
	if (rest.type !== "action" || !rest.params) {
		return JSON.stringify(rest);
	}
	const params = Object.fromEntries(
		Object.entries(rest.params)
			.filter(([key]) => !SECRET_KEYS.has(key))
			.sort(([a], [b]) => a.localeCompare(b)),
	);
	return JSON.stringify({
		...rest,
		...(Object.keys(params).length > 0 ? { params } : { params: undefined }),
	});
}

function describeNode(node: WorkflowNode): string {
	switch (node.type) {
		case "trigger":
			return `trigger on ${node.kinds.join(", ")}`;
		case "rule":
			return `check ${node.ref}`;
		case "gate":
			return `gate ${node.mode}`;
		default:
			return `action ${node.action}`;
	}
}

function edgeKey(edge: WorkflowEdge): string {
	return `${edge.from}>${edge.to}>${edge.when ?? "pass"}`;
}

function describeEdge(
	edge: WorkflowEdge,
	byId: ReadonlyMap<string, WorkflowNode>,
): string {
	const source = byId.get(edge.from);
	const port = source ? edgePort(source, edge.when) : "pass";
	return `${edge.from} → ${edge.to} (${WORKFLOW_PORT_LABELS[port]})`;
}

/**
 * What a push would change on the server. Layout and secrets never count:
 * code carries neither.
 */
export function diffWorkflow(
	server: WorkflowDefinition | null,
	local: WorkflowDefinition,
): WorkflowChange[] {
	if (!server) {
		return [
			{
				change: "added",
				subject: "workflow",
				id: local.id,
				text: `new workflow ${local.name}`,
			},
		];
	}
	const changes: WorkflowChange[] = [];
	if (server.name !== local.name) {
		changes.push({
			change: "changed",
			subject: "workflow",
			id: local.id,
			text: `name ${server.name} → ${local.name}`,
		});
	}
	const before = new Map(server.nodes.map((node) => [node.id, node]));
	const after = new Map(local.nodes.map((node) => [node.id, node]));
	for (const node of local.nodes) {
		const old = before.get(node.id);
		if (!old) {
			changes.push({
				change: "added",
				subject: "step",
				id: node.id,
				text: describeNode(node),
			});
		} else if (comparable(old) !== comparable(node)) {
			changes.push({
				change: "changed",
				subject: "step",
				id: node.id,
				text: describeNode(node),
			});
		}
	}
	for (const node of server.nodes) {
		if (!after.has(node.id)) {
			changes.push({
				change: "removed",
				subject: "step",
				id: node.id,
				text: describeNode(node),
			});
		}
	}
	const oldEdges = new Map(server.edges.map((edge) => [edgeKey(edge), edge]));
	const newEdges = new Map(local.edges.map((edge) => [edgeKey(edge), edge]));
	for (const [key, edge] of newEdges) {
		if (!oldEdges.has(key)) {
			changes.push({
				change: "added",
				subject: "connection",
				id: key,
				text: describeEdge(edge, after),
			});
		}
	}
	for (const [key, edge] of oldEdges) {
		if (!newEdges.has(key)) {
			changes.push({
				change: "removed",
				subject: "connection",
				id: key,
				text: describeEdge(edge, before),
			});
		}
	}
	return changes;
}

function keepSecrets(
	stored: Record<string, JsonValue> | undefined,
	incoming: Record<string, JsonValue> | undefined,
): Record<string, JsonValue> | undefined {
	const secrets = Object.entries(stored ?? {}).filter(
		([key]) => SECRET_KEYS.has(key) && !(incoming && key in incoming),
	);
	if (secrets.length === 0) {
		return incoming;
	}
	return { ...Object.fromEntries(secrets), ...(incoming ?? {}) };
}

/**
 * The definition a push stores: the code's graph, with each step keeping the
 * canvas position and the secrets it already had on the server.
 */
function isEmptyObject(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === 0
	);
}

export function mergeForPush(
	server: WorkflowDefinition | null,
	local: WorkflowDefinition,
): WorkflowDefinition {
	if (!server) {
		return local;
	}
	const before = new Map(server.nodes.map((node) => [node.id, node]));
	return {
		...local,
		version: server.version,
		nodes: local.nodes.map((node) => {
			const old = before.get(node.id);
			if (!old || old.type !== node.type) {
				return node;
			}
			const placed = old.position ? { ...node, position: old.position } : node;
			if (
				placed.type === "rule" &&
				old.type === "rule" &&
				old.ref === placed.ref &&
				old.config === null &&
				isEmptyObject(placed.config)
			) {
				return { ...placed, config: null };
			}
			if (
				placed.type === "action" &&
				old.type === "action" &&
				old.action === placed.action
			) {
				const params = keepSecrets(old.params, placed.params);
				return params ? { ...placed, params } : placed;
			}
			return placed;
		}),
	};
}
