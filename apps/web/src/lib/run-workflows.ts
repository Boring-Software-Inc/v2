import {
	DEFAULT_WORKFLOW,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { z } from "zod";
import type {
	JsonValue,
	RunWorkflowView,
	WorkflowOutcome,
} from "#/lib/runs.functions";

export const RULES_WORKFLOW_ID = DEFAULT_WORKFLOW.id;
export const RULES_WORKFLOW_NAME = "Rules";

const snapshotSchema = z.array(workflowDefinitionSchema).catch([]);

export function parseSnapshot(snapshot: JsonValue): WorkflowDefinition[] {
	return snapshotSchema.parse(snapshot);
}

export interface StepNodeRef {
	workflowId: string | null;
	nodeId: string;
}

export function splitStepNode(
	stepNodeId: string,
	workflowIds: readonly string[],
): StepNodeRef {
	if (stepNodeId.startsWith("run:")) {
		return { workflowId: null, nodeId: stepNodeId };
	}
	const bare = stepNodeId.replace(/:resume$/, "");
	const owner = workflowIds.find((id) => bare.startsWith(`${id}:`));
	if (owner) {
		return { workflowId: owner, nodeId: bare.slice(owner.length + 1) };
	}
	return {
		workflowId: workflowIds.length === 1 ? (workflowIds[0] ?? null) : null,
		nodeId: bare,
	};
}

export function workflowName(definition: { id: string; name: string }) {
	return definition.id === RULES_WORKFLOW_ID
		? RULES_WORKFLOW_NAME
		: definition.name;
}

export function normalizeStepStatus(status: string): string {
	if (status === "failed") {
		return "fail";
	}
	if (status === "passed") {
		return "pass";
	}
	return status;
}

interface OutcomeStep {
	nodeId: string;
	nodeKind: string;
	status: string;
}

export function workflowOutcomes(
	snapshot: WorkflowDefinition[],
	steps: readonly OutcomeStep[],
	runStatus: string,
): RunWorkflowView[] {
	const ids = snapshot.map((definition) => definition.id);
	const evaluating = runStatus === "queued" || runStatus === "running";
	return snapshot.map((definition) => {
		const own = steps.flatMap((step) => {
			const ref = splitStepNode(step.nodeId, ids);
			return ref.workflowId === definition.id
				? [{ ...ref, status: normalizeStepStatus(step.status) }]
				: [];
		});
		const blockNodes = new Set(
			definition.nodes.flatMap((node) =>
				node.type === "action" && node.action === "block" ? [node.id] : [],
			),
		);
		const ruleNodes = definition.nodes.filter((node) => node.type === "rule");
		const doneRules = new Set(
			own.flatMap((step) =>
				ruleNodes.some((node) => node.id === step.nodeId) ? [step.nodeId] : [],
			),
		);
		let outcome: WorkflowOutcome | null = "pass";
		if (own.some((step) => step.status === "paused")) {
			outcome = "review";
		} else if (
			own.some((step) => blockNodes.has(step.nodeId) && step.status === "pass")
		) {
			outcome = "block";
		} else if (evaluating && doneRules.size < ruleNodes.length) {
			outcome = null;
		}
		return {
			id: definition.id,
			name: workflowName(definition),
			outcome,
		};
	});
}
