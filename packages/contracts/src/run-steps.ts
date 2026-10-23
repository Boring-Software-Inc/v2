import { z } from "zod";
import { type Verdict, verdictSchema } from "./runs.ts";
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
	output?: unknown;
}

export interface RunStepView {
	workflow: string | null;
	stepId: string;
	step: string;
	gate: string | null;
	outcome: string;
	summary: string | null;
	kind: string;
	rule: string | null;
	status: string;
}

export const VERDICT_LABELS = {
	pass: "Passed",
	block: "Blocked",
	needs_review: "Waiting for human review",
} as const satisfies Record<Verdict, string>;

const verdictWordSchema = verdictSchema.nullable().catch(null);

export function verdictLabel(verdict: unknown): string | null {
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

const decisionOutputSchema = z
	.object({ decision: z.enum(["approve", "deny"]) })
	.nullable()
	.catch(null);

const DECISION_WORDS = { approve: "Approved", deny: "Blocked" } as const;

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
				workflow: workflow.name,
				stepId: UNRUNNABLE_STEP,
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
): RunStepView[] {
	const names = new Map(
		definitions.map((definition) => [definition.id, stepNames(definition)]),
	);
	const orders = new Map(
		definitions.map((definition) => [definition.id, graphOrder(definition)]),
	);
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
		const found = locate(nodeId, definitions);
		if (!found) {
			return [
				{
					view: {
						workflow: null,
						stepId: nodeId,
						step: RUN_STEP_TITLES.get(nodeId) ?? nodeId,
						gate: null,
						outcome: outcomeWord(step.nodeKind, step.status),
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
				? decisionOutputSchema.parse(step.output ?? null)?.decision
				: undefined;
		return [
			{
				view: {
					workflow: definition.name,
					stepId: node.id,
					step: names.get(definition.id)?.get(node.id) ?? node.id,
					gate: node.type === "gate" ? GATE_WORDS[node.mode] : null,
					outcome: decision
						? DECISION_WORDS[decision]
						: outcomeWord(step.nodeKind, step.status),
					...base,
				},
				group: definitions.indexOf(definition),
				rank: orders.get(definition.id)?.get(node.id) ?? 0,
				resumed: resumed ? 1 : 0,
				index,
			},
		];
	});
	return placed
		.sort(
			(a, b) =>
				a.group - b.group ||
				a.rank - b.rank ||
				a.resumed - b.resumed ||
				a.index - b.index,
		)
		.map((entry) => entry.view);
}
