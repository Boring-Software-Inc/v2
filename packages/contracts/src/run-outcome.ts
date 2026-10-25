import { z } from "zod";
import type { WorkflowDefinition, WorkflowNode } from "./workflow.ts";
import { edgePort, portValue } from "./workflow-connections.ts";

const RESUME_SUFFIX = ":resume";

const QUIET_ACTIONS: ReadonlySet<string> = new Set(["request-fix", "note"]);

export interface OutcomeStep {
	nodeId: string;
	nodeKind: string;
	status: string;
	input?: unknown;
	output?: unknown;
}

export interface OutcomeIssue {
	nodeId: string;
	message: string | null;
	ruleStepIds: string[];
}

export interface ExceptionDecision {
	nodeId: string;
	applied: boolean;
}

export interface RunOutcomes {
	fixes: OutcomeIssue[];
	notes: OutcomeIssue[];
	quietRuleStepIds: ReadonlySet<string>;
	exceptions: ExceptionDecision[];
}

const exceptionOutputSchema = z
	.object({ exceptionApplied: z.boolean() })
	.nullable()
	.catch(null);

const actionInputSchema = z
	.object({
		params: z.object({ message: z.string().optional() }).loose().nullish(),
	})
	.loose()
	.nullable()
	.catch(null);

export function outcomeMessage(input: unknown): string | null {
	const message = actionInputSchema.parse(input ?? null)?.params?.message;
	const trimmed = message?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}

export function exceptionApplied(output: unknown): boolean {
	return exceptionOutputSchema.parse(output ?? null)?.exceptionApplied === true;
}

export function stepLocalId(
	nodeId: string,
	definitionId: string,
): string | null {
	const prefix = `${definitionId}:`;
	if (!nodeId.startsWith(prefix)) {
		return null;
	}
	const local = nodeId.slice(prefix.length);
	return local.endsWith(RESUME_SUFFIX)
		? local.slice(0, -RESUME_SUFFIX.length)
		: local;
}

function settledSteps(
	definition: WorkflowDefinition,
	steps: readonly OutcomeStep[],
): Map<string, OutcomeStep> {
	const settled = new Map<string, OutcomeStep>();
	for (const step of steps) {
		const local = stepLocalId(step.nodeId, definition.id);
		if (local !== null) {
			settled.set(local, step);
		}
	}
	return settled;
}

interface Reach {
	actions: Map<string, string>;
	waived: boolean;
	probe: boolean;
}

function outgoing(definition: WorkflowDefinition, nodeId: string) {
	return definition.edges.filter((edge) => edge.from === nodeId);
}

function reachFrom(
	definition: WorkflowDefinition,
	startId: string,
	settled: ReadonlyMap<string, OutcomeStep>,
): Reach {
	const byId = new Map(definition.nodes.map((node) => [node.id, node]));
	const reach: Reach = { actions: new Map(), waived: false, probe: false };
	const seen = new Set<string>([startId]);
	const queue = [startId];
	for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
		const source = byId.get(at);
		const sourceStep = settled.get(at);
		if (!(source && sourceStep)) {
			continue;
		}
		for (const edge of outgoing(definition, at)) {
			const target = byId.get(edge.to);
			const targetStep = settled.get(edge.to);
			if (!(target && targetStep) || seen.has(edge.to)) {
				continue;
			}
			if (target.type === "gate" && target.mode === "unless") {
				if (edge.input === "exception") {
					reach.probe = true;
					continue;
				}
				if (exceptionApplied(targetStep.output)) {
					reach.waived = true;
					continue;
				}
			}
			if (target.type !== "gate" && !conducts(source, sourceStep, edge.when)) {
				continue;
			}
			seen.add(edge.to);
			if (target.type === "action") {
				reach.actions.set(edge.to, target.action);
				continue;
			}
			queue.push(edge.to);
		}
	}
	return reach;
}

function conducts(
	source: WorkflowNode,
	step: OutcomeStep,
	when: WorkflowDefinition["edges"][number]["when"],
): boolean {
	if (when === "approve" || when === "deny") {
		return false;
	}
	if (step.status !== "pass" && step.status !== "fail") {
		return source.type === "trigger";
	}
	return portValue(edgePort(source, when), step.status) === "pass";
}

function isQuiet(reach: Reach): boolean {
	const kinds = [...reach.actions.values()];
	if (!kinds.every((kind) => QUIET_ACTIONS.has(kind))) {
		return false;
	}
	return kinds.length > 0 || reach.waived || reach.probe;
}

export function runOutcomes(
	definitions: readonly WorkflowDefinition[],
	steps: readonly OutcomeStep[],
): RunOutcomes {
	const fixes: OutcomeIssue[] = [];
	const notes: OutcomeIssue[] = [];
	const quiet = new Set<string>();
	const exceptions: ExceptionDecision[] = [];
	for (const definition of definitions) {
		const settled = settledSteps(definition, steps);
		const sources = new Map<string, string[]>();
		for (const node of definition.nodes) {
			const step = settled.get(node.id);
			if (!step) {
				continue;
			}
			if (node.type === "gate" && node.mode === "unless") {
				exceptions.push({
					nodeId: `${definition.id}:${node.id}`,
					applied: exceptionApplied(step.output),
				});
			}
			if (node.type !== "rule" || step.status !== "fail") {
				continue;
			}
			const reach = reachFrom(definition, node.id, settled);
			const stepId = `${definition.id}:${node.id}`;
			if (isQuiet(reach)) {
				quiet.add(stepId);
			}
			for (const actionId of reach.actions.keys()) {
				sources.set(actionId, [...(sources.get(actionId) ?? []), stepId]);
			}
		}
		for (const node of definition.nodes) {
			const step = settled.get(node.id);
			if (
				node.type !== "action" ||
				step?.status !== "pass" ||
				(node.action !== "request-fix" && node.action !== "note")
			) {
				continue;
			}
			const issue: OutcomeIssue = {
				nodeId: `${definition.id}:${node.id}`,
				message: outcomeMessage(step.input),
				ruleStepIds: sources.get(node.id) ?? [],
			};
			(node.action === "request-fix" ? fixes : notes).push(issue);
		}
	}
	return { fixes, notes, quietRuleStepIds: quiet, exceptions };
}

export function nonEnforcingRuleNodeIds(
	definition: WorkflowDefinition,
): Set<string> {
	const byId = new Map(definition.nodes.map((node) => [node.id, node]));
	const quiet = new Set<string>();
	for (const node of definition.nodes) {
		if (node.type !== "rule") {
			continue;
		}
		const kinds = new Set<string>();
		let probe = false;
		const seen = new Set<string>([node.id]);
		const queue = [node.id];
		for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
			for (const edge of outgoing(definition, at)) {
				const target = byId.get(edge.to);
				if (!target || seen.has(edge.to)) {
					continue;
				}
				if (
					target.type === "gate" &&
					target.mode === "unless" &&
					edge.input === "exception"
				) {
					probe = true;
					continue;
				}
				seen.add(edge.to);
				if (target.type === "action") {
					kinds.add(target.action);
					continue;
				}
				queue.push(edge.to);
			}
		}
		const onlyNotes = [...kinds].every((kind) => kind === "note");
		if (onlyNotes && (kinds.size > 0 || probe)) {
			quiet.add(node.id);
		}
	}
	return quiet;
}
