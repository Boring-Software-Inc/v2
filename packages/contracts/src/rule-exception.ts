import { z } from "zod";
import { type RuleOutcomeSetting, ruleOutcomeAction } from "./rule-outcome.ts";
import type {
	JsonValue,
	WorkflowDefinition,
	WorkflowNode,
} from "./workflow.ts";

export const EXCEPTION_DRAFT_IDS = {
	trigger: "trigger",
	requirement: "requirement",
	gate: "except-when",
	exception: "exception",
	outcome: "outcome",
} as const;

export interface ExceptionDraftRule {
	ref: string;
	config: JsonValue;
	outcome: RuleOutcomeSetting;
}

export function exceptionDraft(input: {
	id: string;
	name: string;
	rule: ExceptionDraftRule;
}): WorkflowDefinition {
	const ids = EXCEPTION_DRAFT_IDS;
	const fail = ruleOutcomeAction(input.rule.outcome);
	const outcome: WorkflowNode = fail.params
		? {
				id: ids.outcome,
				type: "action",
				action: fail.action,
				params: fail.params,
			}
		: { id: ids.outcome, type: "action", action: fail.action };
	return {
		id: input.id,
		name: input.name,
		version: 1,
		nodes: [
			{
				id: ids.trigger,
				type: "trigger",
				kinds: ["change-request.opened", "change-request.updated"],
			},
			{
				id: ids.requirement,
				type: "rule",
				ref: input.rule.ref,
				config: input.rule.config,
			},
			{ id: ids.gate, type: "gate", mode: "unless" },
			{ id: ids.exception, type: "gate", mode: "all-of" },
			outcome,
		],
		edges: [
			{ id: "trigger-requirement", from: ids.trigger, to: ids.requirement },
			{
				id: "requirement-gate",
				from: ids.requirement,
				to: ids.gate,
				input: "requirement",
			},
			{
				id: "exception-gate",
				from: ids.exception,
				to: ids.gate,
				input: "exception",
			},
			{
				id: "gate-outcome",
				from: ids.gate,
				to: ids.outcome,
				when: "fail",
			},
		],
	};
}

function inputSource(
	definition: WorkflowDefinition,
	gateId: string,
	role: "requirement" | "exception",
): WorkflowNode | null {
	const edge = definition.edges.find(
		(entry) => entry.to === gateId && entry.input === role,
	);
	return (
		(edge && definition.nodes.find((node) => node.id === edge.from)) ?? null
	);
}

function leafRules(
	definition: WorkflowDefinition,
	start: WorkflowNode,
): WorkflowNode[] {
	const seen = new Set<string>();
	const found: WorkflowNode[] = [];
	const visit = (node: WorkflowNode) => {
		if (seen.has(node.id)) {
			return;
		}
		seen.add(node.id);
		if (node.type === "rule") {
			found.push(node);
			return;
		}
		if (node.type !== "gate") {
			return;
		}
		for (const edge of definition.edges) {
			const source =
				edge.to === node.id
					? definition.nodes.find((entry) => entry.id === edge.from)
					: undefined;
			if (source) {
				visit(source);
			}
		}
	};
	visit(start);
	return found;
}

export function exceptionRuleNodeIds(
	definition: WorkflowDefinition,
): Set<string> {
	const ids = new Set<string>();
	for (const node of definition.nodes) {
		if (node.type !== "gate" || node.mode !== "unless") {
			continue;
		}
		const source = inputSource(definition, node.id, "exception");
		if (source) {
			for (const rule of leafRules(definition, source)) {
				ids.add(rule.id);
			}
		}
	}
	return ids;
}

export function exceptionRuleNodes(
	definition: WorkflowDefinition,
	gateId: string,
): WorkflowNode[] {
	const source = inputSource(definition, gateId, "exception");
	return source ? leafRules(definition, source) : [];
}

export function exceptionName(
	definition: WorkflowDefinition,
	gateId: string,
	ruleName: (ref: string) => string,
): string | null {
	const names = exceptionRuleNodes(definition, gateId).flatMap((node) =>
		node.type === "rule" ? [ruleName(node.ref)] : [],
	);
	return names.length > 0 ? names.join(", ") : null;
}

export function exceptionLine(name: string): string {
	return `Except: ${name}`;
}

export function ruleExceptionGates(
	definition: WorkflowDefinition,
	ruleId: string,
): string[] {
	return definition.nodes.flatMap((node) => {
		if (node.type !== "gate" || node.mode !== "unless") {
			return [];
		}
		const source = inputSource(definition, node.id, "requirement");
		return source?.type === "rule" && source.ref.split("@")[0] === ruleId
			? [node.id]
			: [];
	});
}

export function ruleExceptionNames(
	definition: WorkflowDefinition,
	ruleId: string,
	ruleName: (ref: string) => string,
): (string | null)[] {
	return ruleExceptionGates(definition, ruleId).map((gateId) =>
		exceptionName(definition, gateId, ruleName),
	);
}

export const unlessDecisionSchema = z.enum([
	"requirement",
	"exception",
	"not-applied",
	"unchecked",
]);
export type UnlessDecision = z.infer<typeof unlessDecisionSchema>;

const unlessOutputSchema = z
	.object({
		requirement: z.string().nullable(),
		exception: z.string().nullable(),
		exceptionApplied: z.boolean(),
	})
	.nullable()
	.catch(null);

export function unlessDecision(output: unknown): UnlessDecision | null {
	const parsed = unlessOutputSchema.parse(output ?? null);
	if (!parsed) {
		return null;
	}
	if (parsed.requirement === "pass") {
		return "requirement";
	}
	if (parsed.exceptionApplied) {
		return "exception";
	}
	if (parsed.requirement !== "fail") {
		return null;
	}
	return parsed.exception === "skipped" || parsed.exception === null
		? "unchecked"
		: "not-applied";
}

export const UNLESS_DECISION_WORDS = {
	requirement: "Requirement passed",
	exception: "Exception applied",
	"not-applied": "Exception did not apply",
	unchecked: "Exception could not be checked",
} as const satisfies Record<UnlessDecision, string>;
