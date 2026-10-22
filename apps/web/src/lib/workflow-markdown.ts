import {
	ACTION_CATALOG,
	type EdgeWhen,
	formatParamValue,
	GATE_CATALOG,
	type JsonValue,
	ruleDisplayName,
	ruleUiSchema,
	TRIGGER_CATALOG,
	type WorkflowDefinition,
	type WorkflowNode,
} from "@tripwire/contracts";
import { z } from "zod";

const stringList = z.array(z.string()).catch([]);

/**
 * Serialize a workflow as markdown for pasting into an issue, Slack, or a PR.
 * Pure: the resolved definition + the repo's custom-rule display entries in, a
 * string out — no fetch, no renderer. Mirrors `run-markdown.ts` (model in,
 * markdown out, sections omitted when empty).
 *
 * SECRET SAFETY BY CONSTRUCTION. Webhook/discord nodes render only WHETHER a
 * url / signing secret is set, never the value. The definition the editor holds
 * is already secret-redacted server-side (`workflow-secrets.ts`), but this
 * serializer would not leak even an un-redacted one: the secret value is never
 * read into the output. The test proves this against a fixture that HAS real
 * webhook and discord urls.
 *
 * A workflow is a DAG; markdown is linear. Branching stays legible without an
 * edge dump because every action states its own firing condition
 * (`when <source> fails`) and every gate names its inputs.
 */

/** A custom rule's display entry — the shape the editor already resolves
 * (`workflow-editor-page.tsx`): ref → name + one-line sentence. */
export interface CustomRuleDisplay {
	ref: string;
	name: string;
	description: string;
}

type TriggerNode = Extract<WorkflowNode, { type: "trigger" }>;
type RuleNode = Extract<WorkflowNode, { type: "rule" }>;
type GateNode = Extract<WorkflowNode, { type: "gate" }>;
type ActionNode = Extract<WorkflowNode, { type: "action" }>;

const WHEN_VERB: Record<EdgeWhen, string> = {
	pass: "passes",
	fail: "fails",
	approve: "is approved by a maintainer",
	deny: "is blocked by a maintainer",
};

const isTrigger = (n: WorkflowNode): n is TriggerNode => n.type === "trigger";
const isRule = (n: WorkflowNode): n is RuleNode => n.type === "rule";
const isGate = (n: WorkflowNode): n is GateNode => n.type === "gate";
const isAction = (n: WorkflowNode): n is ActionNode => n.type === "action";

const asObject = (c: JsonValue): Record<string, JsonValue> =>
	typeof c === "object" && c !== null && !Array.isArray(c) ? c : {};

/** The display name for any node, resolving rule refs through the runtime
 * catalog (built-in names, then the repo's custom-rule entries). */
function nodeName(
	node: WorkflowNode,
	customRules: readonly CustomRuleDisplay[],
): string {
	switch (node.type) {
		case "trigger":
			return "trigger";
		case "rule": {
			const custom = customRules.find((r) => r.ref === node.ref);
			return custom ? custom.name : ruleDisplayName(node.ref);
		}
		case "gate":
			return GATE_CATALOG.find((e) => e.mode === node.mode)?.name ?? node.mode;
		case "action":
			return (
				ACTION_CATALOG.find((e) => e.action === node.action)?.name ??
				node.action
			);
	}
}

/** A rule node's configured one-liner: the custom rule's stored sentence, or
 * the built-in's `ruleUiSchema` sentences filled with THIS node's config. */
function ruleSentence(
	node: RuleNode,
	customRules: readonly CustomRuleDisplay[],
): string | null {
	const custom = customRules.find((r) => r.ref === node.ref);
	if (custom) {
		return custom.description.trim() || null;
	}
	const ui = ruleUiSchema(node.ref);
	if (!ui || ui.sentences.length === 0) {
		return null;
	}
	const config = asObject(node.config);
	const filled = ui.sentences.map((sentence) =>
		ui.params.reduce(
			(text, param) =>
				text.replaceAll(
					`{${param.key}}`,
					formatParamValue(param, config[param.key]),
				),
			sentence,
		),
	);
	return filled.join("; ");
}

/** Whether a secret param is set, WITHOUT reading its value: the redacted
 * `${key}Set` marker, or a non-empty stored string (the un-redacted case). */
function secretSet(params: Record<string, JsonValue>, key: string): boolean {
	if (params[`${key}Set`] === true) {
		return true;
	}
	const value = params[key];
	return typeof value === "string" && value !== "";
}

/** The safe param lines for an action — labels listed; delivery nodes report
 * only whether their url / signing secret is set, never the value. */
function actionParams(node: ActionNode): string[] {
	const params = node.params ?? {};
	if (node.action === "label") {
		const labels = Array.isArray(params.labels)
			? params.labels.filter((l): l is string => typeof l === "string")
			: [];
		return labels.length > 0 ? [`labels: ${labels.join(", ")}`] : [];
	}
	if (node.action === "request-review") {
		const people = stringList.parse(params.reviewers);
		const teams = stringList.parse(params.teamReviewers);
		return [
			...(people.length > 0 ? [`people: ${people.join(", ")}`] : []),
			...(teams.length > 0 ? [`teams: ${teams.join(", ")}`] : []),
		];
	}
	if (node.action === "webhook" || node.action === "discord") {
		const rows = [secretSet(params, "url") ? "url set" : "url not set"];
		if (node.action === "webhook" && secretSet(params, "signingSecret")) {
			rows.push("signing secret set");
		}
		return rows;
	}
	return [];
}

function midSentenceName(
	node: WorkflowNode,
	customRules: readonly CustomRuleDisplay[],
): string {
	const name = nodeName(node, customRules);
	const custom =
		node.type === "rule" && customRules.some((r) => r.ref === node.ref);
	if (custom || !/^[A-Z][a-z]/.test(name)) {
		return name;
	}
	return name.charAt(0).toLowerCase() + name.slice(1);
}

/** How a node is reached: its incoming edges as `when <source> fails`, or `on
 * trigger` for a trigger source. Deduped; joined with `or` for fan-in. */
function firingCondition(
	nodeId: string,
	definition: WorkflowDefinition,
	byId: Map<string, WorkflowNode>,
	customRules: readonly CustomRuleDisplay[],
): string | null {
	const parts = definition.edges
		.filter((edge) => edge.to === nodeId)
		.map((edge) => {
			const source = byId.get(edge.from);
			if (source && source.type === "trigger") {
				return "on trigger";
			}
			const name = source ? midSentenceName(source, customRules) : edge.from;
			return `when ${name} ${WHEN_VERB[edge.when ?? "pass"]}`;
		});
	if (parts.length === 0) {
		return null;
	}
	return [...new Set(parts)].join(" or ");
}

/** The resolved names of the nodes feeding a gate — its aggregation inputs. */
function gateInputs(
	gateId: string,
	definition: WorkflowDefinition,
	byId: Map<string, WorkflowNode>,
	customRules: readonly CustomRuleDisplay[],
): string[] {
	return definition.edges
		.filter((edge) => edge.to === gateId)
		.map((edge) => {
			const source = byId.get(edge.from);
			return source ? nodeName(source, customRules) : edge.from;
		});
}

export function workflowToMarkdown(
	definition: WorkflowDefinition,
	customRules: readonly CustomRuleDisplay[] = [],
): string {
	const byId = new Map(definition.nodes.map((node) => [node.id, node]));
	const nodeCount = definition.nodes.length;
	const lines: string[] = [
		`# Workflow: ${definition.name}`,
		`\`${definition.id}\`, v${definition.version}, ${nodeCount} ${nodeCount === 1 ? "node" : "nodes"}`,
	];

	const triggers = definition.nodes.filter(isTrigger);
	if (triggers.length > 0) {
		const kinds = [...new Set(triggers.flatMap((t) => t.kinds))];
		const names = kinds.map(
			(kind) => TRIGGER_CATALOG.find((e) => e.kind === kind)?.name ?? kind,
		);
		lines.push("", "### Trigger", names.join(", "));
	}

	const rules = definition.nodes.filter(isRule);
	if (rules.length > 0) {
		lines.push("", "### Rules");
		for (const node of rules) {
			const sentence = ruleSentence(node, customRules);
			lines.push(
				`- **${nodeName(node, customRules)}** \`${node.ref}\`${sentence ? `: ${sentence}` : ""}`,
			);
		}
	}

	const gates = definition.nodes.filter(isGate);
	if (gates.length > 0) {
		lines.push("", "### Gates");
		for (const node of gates) {
			const entry = GATE_CATALOG.find((e) => e.mode === node.mode);
			lines.push(
				`- **${entry?.name ?? node.mode}**${entry ? `: ${entry.description}` : ""}`,
			);
			const inputs = gateInputs(node.id, definition, byId, customRules);
			if (inputs.length > 0) {
				lines.push(`  inputs: ${inputs.join(", ")}`);
			}
		}
	}

	const actions = definition.nodes.filter(isAction);
	if (actions.length > 0) {
		lines.push("", "### Actions");
		for (const node of actions) {
			const when = firingCondition(node.id, definition, byId, customRules);
			const suffix = [when, ...actionParams(node)].filter(Boolean).join(", ");
			lines.push(
				`- **${nodeName(node, customRules)}**${suffix ? `: ${suffix}` : ""}`,
			);
		}
	}

	return lines.join("\n");
}
