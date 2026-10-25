import { z } from "zod";
import {
	DEFAULT_SCHEDULE_TIMEZONE,
	type JsonValue,
	jsonValueSchema,
	type WorkflowDefinition,
	type WorkflowEdge,
	type WorkflowNode,
} from "./workflow.ts";
import { edgePort, WORKFLOW_PORT_LABELS } from "./workflow-connections.ts";
import {
	describeSchedule,
	scheduleZoneWord,
} from "./workflow-schedule-text.ts";

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

const listSchema = z.array(jsonValueSchema);
const objectSchema = z.record(z.string(), jsonValueSchema);

function canonical(value: JsonValue): JsonValue {
	const list = listSchema.safeParse(value);
	if (list.success) {
		return list.data.map(canonical);
	}
	const object = objectSchema.safeParse(value);
	if (!object.success) {
		return value;
	}
	return Object.fromEntries(
		Object.keys(object.data)
			.sort()
			.map((key) => [key, canonical(object.data[key] ?? null)]),
	);
}

function asJson(value: WorkflowNode | Record<string, JsonValue>): JsonValue {
	return jsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}

function comparable(node: WorkflowNode): string {
	const { position: _position, ...rest } = node;
	if (rest.type === "rule") {
		return JSON.stringify(
			canonical(asJson({ ...rest, config: rest.config ?? {} })),
		);
	}
	if (rest.type !== "action") {
		return JSON.stringify(canonical(asJson(rest)));
	}
	const params = Object.fromEntries(
		Object.entries(rest.params ?? {}).filter(([key]) => !SECRET_KEYS.has(key)),
	);
	const { params: _params, ...bare } = rest;
	return JSON.stringify(
		canonical(
			asJson(Object.keys(params).length > 0 ? { ...bare, params } : bare),
		),
	);
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

type Shown = JsonValue | undefined;

const textSchema = z.string();
const recordSchema = z.record(z.string(), jsonValueSchema);

function shownItem(value: JsonValue): string {
	const text = textSchema.safeParse(value);
	return text.success ? text.data : JSON.stringify(canonical(value));
}

function shown(value: Shown): string {
	if (value === undefined || value === null) {
		return "none";
	}
	if (Array.isArray(value)) {
		return value.length === 0 ? "none" : value.map(shownItem).join(", ");
	}
	return shownItem(value);
}

function flatten(
	value: Shown,
	prefix: string,
	into: Map<string, string>,
): Map<string, string> {
	const record = recordSchema.safeParse(value);
	if (record.success && Object.keys(record.data).length > 0) {
		for (const [key, inner] of Object.entries(record.data)) {
			flatten(inner, prefix ? `${prefix}.${key}` : key, into);
		}
	} else if (prefix) {
		into.set(prefix, shown(value));
	}
	return into;
}

function nodeFields(node: WorkflowNode): Map<string, string> {
	const fields = new Map<string, string>();
	switch (node.type) {
		case "trigger": {
			fields.set("on", node.kinds.join(", "));
			if (!node.schedule) {
				return fields;
			}
			const { every, timezone, match } = node.schedule;
			fields.set(
				"every",
				every ? describeSchedule({ every, timezone }) : "none",
			);
			fields.set("timezone", timezone ?? "none");
			return flatten(match, "match", fields);
		}
		case "rule":
			fields.set("ref", node.ref);
			return flatten(node.config, "", fields);
		case "gate":
			fields.set("mode", node.mode);
			return fields;
		default: {
			fields.set("action", node.action);
			const params = Object.fromEntries(
				Object.entries(node.params ?? {}).filter(
					([key]) => !SECRET_KEYS.has(key),
				),
			);
			return flatten(params, "", fields);
		}
	}
}

/** Each field a step changed, as `id.field: before → after`. */
function fieldChanges(old: WorkflowNode, node: WorkflowNode): string[] {
	if (old.type !== node.type) {
		return [`${node.id}: ${describeNode(old)} → ${describeNode(node)}`];
	}
	const before = nodeFields(old);
	const after = nodeFields(node);
	const everyBefore = before.get("every");
	const everyAfter = after.get("every") ?? "";
	const zoneInEvery = (zone: string) =>
		everyBefore !== everyAfter &&
		everyAfter.endsWith(
			` in ${scheduleZoneWord(zone === "none" ? DEFAULT_SCHEDULE_TIMEZONE : zone)}`,
		);
	const lines: string[] = [];
	for (const key of new Set([...before.keys(), ...after.keys()])) {
		const was = before.get(key) ?? "none";
		const now = after.get(key) ?? "none";
		if (was === now || (key === "timezone" && zoneInEvery(now))) {
			continue;
		}
		lines.push(`${node.id}.${key}: ${was} → ${now}`);
	}
	return lines;
}

function edgeKey(edge: WorkflowEdge): string {
	return `${edge.from}>${edge.to}>${edge.when ?? "pass"}>${edge.input ?? ""}`;
}

function describeEdge(
	edge: WorkflowEdge,
	byId: ReadonlyMap<string, WorkflowNode>,
): string {
	const source = byId.get(edge.from);
	const port = source ? edgePort(source, edge.when) : "pass";
	const role = edge.input ? ` as the ${edge.input}` : "";
	return `${edge.from} → ${edge.to} (${WORKFLOW_PORT_LABELS[port]})${role}`;
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
				text: JSON.stringify(local.name),
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
			for (const text of fieldChanges(old, node)) {
				changes.push({ change: "changed", subject: "step", id: node.id, text });
			}
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
const emptyConfigSchema = z.object({}).strict();

function isEmptyObject(value: JsonValue): boolean {
	return emptyConfigSchema.safeParse(value).success;
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

export interface WorkflowChangeSet {
	renamed: boolean;
	nodes: { added: string[]; changed: string[]; removed: string[] };
	edges: { added: string[]; removed: string[] };
}

export function emptyChangeSet(): WorkflowChangeSet {
	return {
		renamed: false,
		nodes: { added: [], changed: [], removed: [] },
		edges: { added: [], removed: [] },
	};
}

export function changeSetSize(set: WorkflowChangeSet): number {
	return (
		set.nodes.added.length +
		set.nodes.changed.length +
		set.nodes.removed.length +
		set.edges.added.length +
		set.edges.removed.length +
		(set.renamed ? 1 : 0)
	);
}

/**
 * The node and edge ids one definition changed against another, so a viewer
 * can animate exactly what moved. Position never counts as a change.
 */
export function workflowChangeSet(
	before: WorkflowDefinition | null,
	after: WorkflowDefinition,
): WorkflowChangeSet {
	const set = emptyChangeSet();
	const old = new Map((before?.nodes ?? []).map((node) => [node.id, node]));
	const next = new Set(after.nodes.map((node) => node.id));
	set.renamed = before !== null && before.name !== after.name;
	for (const node of after.nodes) {
		const was = old.get(node.id);
		if (!was) {
			set.nodes.added.push(node.id);
		} else if (comparable(was) !== comparable(node)) {
			set.nodes.changed.push(node.id);
		}
	}
	for (const node of before?.nodes ?? []) {
		if (!next.has(node.id)) {
			set.nodes.removed.push(node.id);
		}
	}
	const oldEdges = new Set((before?.edges ?? []).map(edgeKey));
	const newEdges = new Set(after.edges.map(edgeKey));
	for (const edge of after.edges) {
		if (!oldEdges.has(edgeKey(edge))) {
			set.edges.added.push(edge.id);
		}
	}
	for (const edge of before?.edges ?? []) {
		if (!newEdges.has(edgeKey(edge))) {
			set.edges.removed.push(edge.id);
		}
	}
	return set;
}
