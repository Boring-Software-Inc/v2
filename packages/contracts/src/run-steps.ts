import { z } from "zod";
import {
	type GateMode,
	type WorkflowDefinition,
	type WorkflowNode,
	workflowDefinitionSchema,
} from "./workflow.ts";
import { WORKFLOW_PORTS } from "./workflow-connections.ts";
import { stepNames } from "./workflow-lint.ts";

export interface RunStepInput {
	nodeId: string;
	nodeKind: string;
	ruleId: string | null;
	status: string;
	summary: string | null;
}

export interface RunStepView {
	workflow: string | null;
	stepId: string;
	step: string;
	gate: string | null;
	outcome: string;
	summary: string | null;
}

const RUN_STEP_TITLES: Record<string, string> = {
	"run:deny-floor": "Human review blocked it",
	"run:unrunnable": "A workflow could not run",
	"run:degradation": "Too few checks could run",
};

const GATE_WORDS: Record<GateMode, string> = {
	"all-of": "all of",
	"any-of": "any of",
	not: "not",
};

const RESUME_SUFFIX = ":resume";

const snapshotSchema = z.array(workflowDefinitionSchema);

function outcomeWord(kind: string, status: string): string {
	if (status === "skipped") {
		return "Could not run";
	}
	if (status === "disabled") {
		return "Turned off";
	}
	if (status === "paused") {
		return "Waiting for human review";
	}
	if (kind === "rule" || kind === "gate") {
		if (status === "pass") {
			return WORKFLOW_PORTS.pass.label;
		}
		if (status === "fail") {
			return WORKFLOW_PORTS.fail.label;
		}
	}
	if (status === "pass") {
		return "Ran";
	}
	if (status === "fail") {
		return "Failed";
	}
	return status;
}

function locate(
	nodeId: string,
	definitions: readonly WorkflowDefinition[],
): { definition: WorkflowDefinition; node: WorkflowNode } | null {
	for (const definition of definitions) {
		const prefix = `${definition.id}:`;
		if (!nodeId.startsWith(prefix)) {
			continue;
		}
		const id = nodeId.slice(prefix.length);
		const node = definition.nodes.find((candidate) => candidate.id === id);
		if (node) {
			return { definition, node };
		}
	}
	return null;
}

/** Each run step in product words: its workflow, its title and what came of it. */
export function describeRunSteps(
	snapshot: unknown,
	steps: readonly RunStepInput[],
): RunStepView[] {
	const parsed = snapshotSchema.safeParse(snapshot);
	const definitions = parsed.success ? parsed.data : [];
	const names = new Map(
		definitions.map((definition) => [definition.id, stepNames(definition)]),
	);
	return steps.map((step) => {
		const resumed = step.nodeId.endsWith(RESUME_SUFFIX);
		const nodeId = resumed
			? step.nodeId.slice(0, -RESUME_SUFFIX.length)
			: step.nodeId;
		const found = locate(nodeId, definitions);
		const outcome = outcomeWord(step.nodeKind, step.status);
		if (!found) {
			return {
				workflow: null,
				stepId: nodeId,
				step: RUN_STEP_TITLES[nodeId] ?? nodeId,
				gate: null,
				outcome,
				summary: step.summary,
			};
		}
		const { definition, node } = found;
		const title = names.get(definition.id)?.get(node.id) ?? node.id;
		return {
			workflow: definition.name,
			stepId: node.id,
			step: resumed ? `${title} (after review)` : title,
			gate: node.type === "gate" ? GATE_WORDS[node.mode] : null,
			outcome,
			summary: step.summary,
		};
	});
}
