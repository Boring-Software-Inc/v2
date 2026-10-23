import { z } from "zod";
import { RUN_RESULT_LABELS } from "./run-result.ts";
import { type Verdict, verdictSchema } from "./runs.ts";
import {
	type GateMode,
	type WorkflowDefinition,
	type WorkflowNode,
	workflowDefinitionSchema,
	workflowDisplayName,
} from "./workflow.ts";
import { WORKFLOW_PORTS } from "./workflow-connections.ts";
import { stepNames } from "./workflow-lint.ts";

export interface RunStepInput {
	nodeId: string;
	nodeKind: string;
	ruleId: string | null;
	status: string;
	summary: string | null;
	input?: unknown;
	output?: unknown;
}

export interface RunStepView {
	workflow: string | null;
	stepId: string | null;
	step: string;
	gate: string | null;
	outcome: string;
	summary: string | null;
	kind: string;
	rule: string | null;
	status: string;
}

export const VERDICT_LABELS = {
	pass: RUN_RESULT_LABELS.pass,
	block: RUN_RESULT_LABELS.block,
	needs_review: RUN_RESULT_LABELS.needs_review,
} as const satisfies Record<Verdict, string>;

const verdictWordSchema = verdictSchema.nullable().catch(null);

export function verdictLabel(
	verdict: string | null | undefined,
): string | null {
	const parsed = verdictWordSchema.parse(verdict ?? null);
	return parsed ? VERDICT_LABELS[parsed] : null;
}

const RUN_STEP_TITLES = new Map([
	["run:deny-floor", "Human review blocked it"],
	["run:unrunnable", "A workflow could not run"],
	["run:degradation", "Too few checks could run"],
]);

const GATE_WORDS = {
	"all-of": "all of",
	"any-of": "any of",
	not: "not",
} as const satisfies Record<GateMode, string>;

const RESUME_SUFFIX = ":resume";

const UNRUNNABLE_STEP = "run:unrunnable";

/** A stored workflow snapshot, or none when it does not parse. */
export const runSnapshotSchema = z.array(workflowDefinitionSchema).catch([]);

const unrunnableOutputSchema = z
	.object({
		workflows: z.array(z.object({ id: z.string(), name: z.string() })),
		issues: z
			.array(
				z.object({ workflowId: z.string(), messages: z.array(z.string()) }),
			)
			.optional(),
	})
	.catch({ workflows: [] });

const decisionInputSchema = z
	.object({ decision: z.enum(["approve", "deny"]) })
	.nullable()
	.catch(null);

const DENY_FLOOR_STEP = "run:deny-floor";

const denyFloorInputSchema = z
	.object({ pausedNodeId: z.string() })
	.nullable()
	.catch(null);

const DECISION_WORDS = { approve: "Approved", deny: "Blocked" } as const;

function outcomeWord(kind: string, status: string, closed = false): string {
	if (status === "skipped") {
		return "Could not run";
	}
	if (status === "disabled") {
		return "Turned off";
	}
	if (status === "paused") {
		return closed
			? RUN_RESULT_LABELS["closed-before-review"]
			: RUN_RESULT_LABELS.needs_review;
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

function graphOrder(definition: WorkflowDefinition): Map<string, number> {
	const incoming = new Map(definition.nodes.map((node) => [node.id, 0]));
	for (const edge of definition.edges) {
		incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
	}
	const order = new Map<string, number>();
	const ready = definition.nodes.filter(
		(node) => (incoming.get(node.id) ?? 0) === 0,
	);
	while (ready.length > 0) {
		const node = ready.shift();
		if (!node || order.has(node.id)) {
			continue;
		}
		order.set(node.id, order.size);
		for (const edge of definition.edges) {
			if (edge.from !== node.id) {
				continue;
			}
			const left = (incoming.get(edge.to) ?? 0) - 1;
			incoming.set(edge.to, left);
			const next = definition.nodes.find((n) => n.id === edge.to);
			if (left === 0 && next) {
				ready.push(next);
			}
		}
	}
	for (const node of definition.nodes) {
		if (!order.has(node.id)) {
			order.set(node.id, order.size);
		}
	}
	return order;
}

interface Placed {
	view: RunStepView;
	group: number;
	rank: number;
	resumed: number;
	index: number;
	waitingOn?: string;
	floorFor?: string;
}

function unrunnableRows(
	step: RunStepInput,
	definitions: readonly WorkflowDefinition[],
	index: number,
): Placed[] {
	const output = unrunnableOutputSchema.parse(step.output);
	if (output.workflows.length === 0) {
		return [];
	}
	return output.workflows.map((workflow) => {
		const at = definitions.findIndex((d) => d.id === workflow.id);
		const messages =
			output.issues?.find((issue) => issue.workflowId === workflow.id)
				?.messages ?? [];
		return {
			view: {
				workflow: workflowDisplayName(workflow),
				stepId: null,
				step: "Its wiring is broken, so Tripwire did not run it",
				gate: null,
				outcome: outcomeWord(step.nodeKind, step.status),
				summary: messages.length > 0 ? messages.join(" ") : step.summary,
				kind: step.nodeKind,
				rule: step.ruleId,
				status: step.status,
			},
			group: at >= 0 ? at : definitions.length,
			rank: -1,
			resumed: 0,
			index,
		};
	});
}

/** Each run step in product words: its workflow, its title and what came of it. */
export function describeRunSteps(
	definitions: readonly WorkflowDefinition[],
	steps: readonly RunStepInput[],
	runStatus?: string,
): RunStepView[] {
	const closed = runStatus === "closed";
	const names = new Map(
		definitions.map((definition) => [definition.id, stepNames(definition)]),
	);
	const orders = new Map(
		definitions.map((definition) => [definition.id, graphOrder(definition)]),
	);
	const decided = new Set<string>();
	const placed = steps.flatMap((step, index): Placed[] => {
		const resumed = step.nodeId.endsWith(RESUME_SUFFIX);
		const nodeId = resumed
			? step.nodeId.slice(0, -RESUME_SUFFIX.length)
			: step.nodeId;
		if (nodeId === UNRUNNABLE_STEP) {
			const rows = unrunnableRows(step, definitions, index);
			if (rows.length > 0) {
				return rows;
			}
		}
		const base = {
			summary: step.summary,
			kind: step.nodeKind,
			rule: step.ruleId,
			status: step.status,
		};
		if (nodeId === DENY_FLOOR_STEP) {
			const paused = denyFloorInputSchema.parse(step.input ?? null);
			const owner = paused ? locate(paused.pausedNodeId, definitions) : null;
			if (owner) {
				return [
					{
						view: {
							workflow: workflowDisplayName(owner.definition),
							stepId: null,
							step: RUN_STEP_TITLES.get(nodeId) ?? nodeId,
							gate: null,
							outcome: DECISION_WORDS.deny,
							...base,
						},
						group: definitions.indexOf(owner.definition),
						rank: orders.get(owner.definition.id)?.get(owner.node.id) ?? 0,
						resumed: 2,
						index,
						floorFor: `${owner.definition.id}:${owner.node.id}`,
					},
				];
			}
		}
		const found = locate(nodeId, definitions);
		if (!found) {
			const title = RUN_STEP_TITLES.get(nodeId);
			return [
				{
					view: {
						workflow: null,
						stepId: title ? null : nodeId,
						step: title ?? nodeId,
						gate: null,
						outcome: outcomeWord(step.nodeKind, step.status, closed),
						...base,
					},
					group: definitions.length + 1,
					rank: 0,
					resumed: 0,
					index,
				},
			];
		}
		const { definition, node } = found;
		const decision =
			resumed && node.type === "action" && node.action === "send-to-moderation"
				? decisionInputSchema.parse(step.input ?? null)?.decision
				: undefined;
		if (decision) {
			decided.add(`${definition.id}:${node.id}`);
		}
		return [
			{
				view: {
					workflow: workflowDisplayName(definition),
					stepId: node.id,
					step: names.get(definition.id)?.get(node.id) ?? node.id,
					gate: node.type === "gate" ? GATE_WORDS[node.mode] : null,
					outcome: decision
						? DECISION_WORDS[decision]
						: outcomeWord(step.nodeKind, step.status, closed),
					...base,
				},
				group: definitions.indexOf(definition),
				rank: orders.get(definition.id)?.get(node.id) ?? 0,
				resumed: resumed ? 1 : 0,
				index,
				waitingOn:
					step.status === "paused" ? `${definition.id}:${node.id}` : undefined,
			},
		];
	});
	return placed
		.filter(
			(entry) =>
				!(entry.waitingOn && decided.has(entry.waitingOn)) &&
				!(entry.floorFor && decided.has(entry.floorFor)),
		)
		.sort(
			(a, b) =>
				a.group - b.group ||
				a.rank - b.rank ||
				a.resumed - b.resumed ||
				a.index - b.index,
		)
		.map((entry) => entry.view);
}
