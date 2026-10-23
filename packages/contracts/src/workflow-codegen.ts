import { z } from "zod";
import { RULE_CATALOG } from "./rules.ts";
import {
	triggerScheduleSchema,
	type WorkflowDefinition,
	type WorkflowEdge,
	type WorkflowNode,
} from "./workflow.ts";
import {
	AUTHORING_ACTION_PARAMS,
	AUTHORING_EVENT_KINDS,
} from "./workflow-authoring-catalog.ts";

const jsonSchemaNode: z.ZodType<JsonSchemaNode> = z.lazy(() =>
	z.object({
		type: z.string().optional(),
		const: z.unknown().optional(),
		enum: z.array(z.unknown()).optional(),
		items: jsonSchemaNode.optional(),
		properties: z.record(z.string(), jsonSchemaNode).optional(),
		required: z.array(z.string()).optional(),
		anyOf: z.array(jsonSchemaNode).optional(),
		oneOf: z.array(jsonSchemaNode).optional(),
	}),
);

interface JsonSchemaNode {
	type?: string;
	const?: unknown;
	enum?: unknown[];
	items?: JsonSchemaNode;
	properties?: Record<string, JsonSchemaNode>;
	required?: string[];
	anyOf?: JsonSchemaNode[];
	oneOf?: JsonSchemaNode[];
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function propertyKey(key: string): string {
	return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function printSchema(node: JsonSchemaNode, indent: string): string {
	const union = node.anyOf ?? node.oneOf;
	if (union) {
		return union.map((member) => printSchema(member, indent)).join(" | ");
	}
	if (node.const !== undefined) {
		return JSON.stringify(node.const);
	}
	if (node.enum) {
		return node.enum.map((value) => JSON.stringify(value)).join(" | ");
	}
	switch (node.type) {
		case "string":
			return "string";
		case "integer":
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "array":
			return `readonly (${node.items ? printSchema(node.items, indent) : "unknown"})[]`;
		case "object": {
			const entries = Object.entries(node.properties ?? {});
			if (entries.length === 0) {
				return "Record<never, never>";
			}
			const inner = `${indent}\t`;
			const lines = entries.map(
				([key, value]) =>
					`${inner}readonly ${propertyKey(key)}${node.required?.includes(key) ? "" : "?"}: ${printSchema(value, inner)};`,
			);
			return `{\n${lines.join("\n")}\n${indent}}`;
		}
		default:
			return "unknown";
	}
}

/** A zod schema's input type, printed as TypeScript. */
export function schemaTypeText(schema: z.ZodType, indent = ""): string {
	const parsed = jsonSchemaNode.safeParse(
		z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
	);
	return parsed.success ? printSchema(parsed.data, indent) : "unknown";
}

/**
 * The catalog as plain TypeScript, for a project's copy of the authoring
 * module: no zod, nothing to install.
 */
export function authoringCatalogTypes(): string {
	const rules = RULE_CATALOG.map(
		(entry) =>
			`\t\treadonly ${propertyKey(entry.ruleId)}: ${schemaTypeText(entry.configSchema, "\t\t")};`,
	);
	const actions = Object.entries(AUTHORING_ACTION_PARAMS).map(
		([kind, schema]) =>
			`\t\treadonly ${propertyKey(kind)}: ${schemaTypeText(schema, "\t\t")};`,
	);
	const events = AUTHORING_EVENT_KINDS.map((kind) => JSON.stringify(kind)).join(
		" | ",
	);
	return [
		"export interface TripwireCatalog {",
		"\treadonly rules: {",
		...rules,
		"\t};",
		"\treadonly actions: {",
		...actions,
		"\t};",
		`\treadonly events: ${events};`,
		`\treadonly schedule: ${schemaTypeText(triggerScheduleSchema, "\t")};`,
		"}",
	].join("\n");
}

export const AUTHORING_HELPERS = [
	"allOf",
	"anyOf",
	"block",
	"check",
	"close",
	"customCheck",
	"discord",
	"humanReview",
	"label",
	"lock",
	"not",
	"postComment",
	"removeLabel",
	"requestReview",
	"schedule",
	"trigger",
	"webhook",
	"workflow",
	"workflows",
] as const;

const RESERVED = new Set<string>([
	...AUTHORING_HELPERS,
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"let",
	"new",
	"null",
	"return",
	"static",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
	"await",
]);

function camel(text: string): string {
	const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
	const joined = words
		.map((word, index) =>
			index === 0
				? word.charAt(0).toLowerCase() + word.slice(1)
				: word.charAt(0).toUpperCase() + word.slice(1),
		)
		.join("");
	const safe = /^[0-9]/.test(joined) ? `step${joined}` : joined || "step";
	return RESERVED.has(safe) ? `${safe}Step` : safe;
}

const SECRET_KEYS = new Set([
	"url",
	"signingSecret",
	"urlSet",
	"signingSecretSet",
]);

const ACTION_HELPER = {
	block: "block",
	label: "label",
	"remove-label": "removeLabel",
	"request-review": "requestReview",
	"post-comment": "postComment",
	lock: "lock",
	close: "close",
	webhook: "webhook",
	discord: "discord",
	"send-to-moderation": "humanReview",
} as const;

const TAKES_NO_PARAMS = new Set(["block", "close", "send-to-moderation"]);

function literal(value: unknown, indent: string): string {
	const text = JSON.stringify(value, null, "\t");
	return (text ?? "null").replaceAll("\n", `\n${indent}`);
}

function inputText(
	edge: WorkflowEdge,
	names: ReadonlyMap<string, string>,
	byId: ReadonlyMap<string, WorkflowNode>,
): string {
	const name = names.get(edge.from) ?? "missing";
	const source = byId.get(edge.from);
	switch (edge.when) {
		case "fail":
			return `${name}.fails`;
		case "approve":
			return `${name}.approved`;
		case "deny":
			return `${name}.denied`;
		default:
			return source?.type === "trigger" ||
				source?.type === "rule" ||
				source?.type === "gate"
				? name
				: `${name}.passes`;
	}
}

function topological(definition: WorkflowDefinition): WorkflowNode[] {
	const remaining = new Map(
		definition.nodes.map((node) => [
			node.id,
			definition.edges.filter((edge) => edge.to === node.id).length,
		]),
	);
	const order: WorkflowNode[] = [];
	const pending = [...definition.nodes];
	while (pending.length > 0) {
		const index = pending.findIndex((node) => remaining.get(node.id) === 0);
		const [next] = pending.splice(index === -1 ? 0 : index, 1);
		if (!next) {
			break;
		}
		order.push(next);
		for (const edge of definition.edges.filter((e) => e.from === next.id)) {
			remaining.set(edge.to, (remaining.get(edge.to) ?? 1) - 1);
		}
	}
	return order;
}

function stepExpression(
	node: WorkflowNode,
	inputs: string[],
	warnings: string[],
	indent: string,
): string | null {
	const after = inputs.length > 0 ? `.after(${inputs.join(", ")})` : "";
	switch (node.type) {
		case "trigger": {
			if (node.schedule) {
				return `schedule(${literal(node.schedule, indent)})`;
			}
			return `trigger(${node.kinds.map((kind) => JSON.stringify(kind)).join(", ")})`;
		}
		case "rule": {
			const [ruleId = node.ref, versionText] = node.ref.split("@");
			const version = Number(versionText);
			const entry = RULE_CATALOG.find((rule) => rule.ruleId === ruleId);
			const config =
				node.config !== null &&
				typeof node.config === "object" &&
				!Array.isArray(node.config) &&
				Object.keys(node.config).length === 0
					? null
					: literal(node.config, indent);
			if (!entry) {
				return `customCheck(${JSON.stringify(ruleId)}${config ? `, ${config}` : ""})${after}`;
			}
			const pin = version === entry.version ? "" : `, { version: ${version} }`;
			const args = config ?? (pin ? "{}" : "");
			return `check(${JSON.stringify(ruleId)}${args ? `, ${args}` : ""}${pin})${after}`;
		}
		case "gate": {
			if (node.mode === "not") {
				if (inputs.length > 1) {
					warnings.push(`${node.id}: a Not gate keeps only its first input`);
				}
				return `not(${inputs[0] ?? ""})`;
			}
			return `${node.mode === "all-of" ? "allOf" : "anyOf"}(${inputs.join(", ")})`;
		}
		case "action": {
			if (node.action === "comment") {
				warnings.push(
					`${node.id}: the Comment step was removed and is left out`,
				);
				return null;
			}
			const helper = ACTION_HELPER[node.action];
			const params = Object.fromEntries(
				Object.entries(node.params ?? {}).filter(
					([key]) => !SECRET_KEYS.has(key),
				),
			);
			const args =
				TAKES_NO_PARAMS.has(node.action) || Object.keys(params).length === 0
					? ""
					: literal(params, indent);
			return `${helper}(${args})${after}`;
		}
		default:
			return null;
	}
}

export interface CodegenResult {
	code: string;
	/** Things the code cannot say, so a push of it would drop them. */
	warnings: string[];
}

function workflowFunction(
	definition: WorkflowDefinition,
	functionName: string,
	warnings: string[],
): string {
	const byId = new Map(definition.nodes.map((node) => [node.id, node]));
	const names = new Map<string, string>();
	const used = new Set<string>();
	for (const node of definition.nodes) {
		const base = camel(node.id);
		let name = base;
		for (let n = 2; used.has(name); n++) {
			name = `${base}${n}`;
		}
		used.add(name);
		names.set(node.id, name);
	}
	const lines: string[] = [];
	const kept: string[] = [];
	for (const node of topological(definition)) {
		const inputs = definition.edges
			.filter((edge) => edge.to === node.id)
			.map((edge) => inputText(edge, names, byId));
		const expression = stepExpression(node, inputs, warnings, "\t");
		if (expression === null) {
			continue;
		}
		if (node.type !== "trigger" && inputs.length === 0) {
			warnings.push(
				`${node.id}: nothing leads into it, so it will run straight after the triggers`,
			);
		}
		lines.push(`\tconst ${names.get(node.id)} = ${expression};`);
		kept.push(node.id);
	}
	const steps = kept.map((id) => {
		const name = names.get(id) ?? id;
		return id === name
			? `\t\t\t${name},`
			: `\t\t\t${propertyKey(id)}: ${name},`;
	});
	return [
		`function ${functionName}() {`,
		...lines,
		"\treturn workflow({",
		`\t\tname: ${JSON.stringify(definition.name)},`,
		"\t\tsteps: {",
		...steps,
		"\t\t},",
		"\t});",
		"}",
	].join("\n");
}

/**
 * Writes stored definitions back as a `tripwire.ts` module. Every step is
 * named by its id, so a push of the result changes nothing but layout.
 */
export function workflowsToCode(
	definitions: readonly WorkflowDefinition[],
	options: { importFrom: string },
): CodegenResult {
	const warnings: string[] = [];
	const used = new Set<string>();
	const blocks: string[] = [];
	const entries: string[] = [];
	for (const definition of definitions) {
		const base = camel(definition.name || definition.id);
		let name = base;
		for (let n = 2; used.has(name); n++) {
			name = `${base}${n}`;
		}
		used.add(name);
		blocks.push(workflowFunction(definition, name, warnings));
		entries.push(`\t${JSON.stringify(definition.id)}: ${name}(),`);
	}
	const body = [
		...blocks,
		`export default workflows({\n${entries.join("\n")}\n});`,
	].join("\n\n");
	const helpers = AUTHORING_HELPERS.filter((helper) =>
		new RegExp(`\\b${helper}\\(`).test(body),
	);
	const code = [
		`import {\n${helpers.map((helper) => `\t${helper},`).join("\n")}\n} from ${JSON.stringify(options.importFrom)};`,
		body,
	].join("\n\n");
	return { code: `${code}\n`, warnings };
}

/**
 * A project's copy of the authoring module: the import-free source of
 * `workflow-authoring.ts`, the catalog as plain types, and the helpers bound
 * to it.
 */
export function authoringModuleText(authoringSource: string): string {
	return [
		authoringSource.trimEnd(),
		authoringCatalogTypes(),
		`export const {\n${AUTHORING_HELPERS.map((helper) => `\t${helper},`).join("\n")}\n} = authoring<TripwireCatalog>();`,
	]
		.join("\n\n")
		.concat("\n");
}
