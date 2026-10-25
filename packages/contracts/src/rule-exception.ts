import { z } from "zod";
import type {
	JsonValue,
	WorkflowDefinition,
	WorkflowNode,
} from "./workflow.ts";

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

export function unlessDecision(
	output: JsonValue | undefined,
): UnlessDecision | null {
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
