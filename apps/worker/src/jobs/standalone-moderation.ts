import {
	CONTRIBUTOR_ALLOWLIST_RULE_ID,
	type JsonValue,
	type ModerationOutcome,
	type ModerationSubject,
	ruleIdOf,
	standaloneModerationDecisionSchema,
	type WorkflowDefinition,
	type WorkflowNode,
} from "@tripwire/contracts";
import type { ExecutionResult } from "@tripwire/core";

export const STANDALONE_OUTCOME_NODE = "moderation-outcome";

const OUTCOME_PRIORITY = {
	warn: 0,
	"human-review": 1,
	block: 2,
	close: 3,
} satisfies Record<ModerationOutcome, number>;

const PULL_REQUEST_RULES = new Set([
	"ai-review",
	"crypto-address",
	"english-only",
	"honeypot",
	"max-files-changed",
	"pr-rate-limit",
]);

export function standaloneChecks(
	definition: WorkflowDefinition,
	subject: ModerationSubject,
): WorkflowDefinition {
	const nodes = definition.nodes.flatMap((node): WorkflowNode[] => {
		if (node.type === "trigger") {
			return [
				subject === "issue" ? { ...node, kinds: ["issue.opened"] } : node,
			];
		}
		if (
			node.type === "rule" &&
			(subject !== "issue" || !PULL_REQUEST_RULES.has(ruleIdOf(node.ref)))
		) {
			return [node];
		}
		return [];
	});
	const ids = new Set(nodes.map((node) => node.id));
	return {
		...definition,
		nodes,
		edges: definition.edges.filter(
			(edge) => ids.has(edge.from) && ids.has(edge.to),
		),
	};
}

export function strictAllowlistChecks(
	definition: WorkflowDefinition,
): WorkflowDefinition {
	const nodes = definition.nodes.filter(
		(node) =>
			node.type === "trigger" ||
			(node.type === "rule" &&
				ruleIdOf(node.ref) === CONTRIBUTOR_ALLOWLIST_RULE_ID),
	);
	const ids = new Set(nodes.map((node) => node.id));
	return {
		...definition,
		nodes,
		edges: definition.edges.filter(
			(edge) => ids.has(edge.from) && ids.has(edge.to),
		),
	};
}

export function applyStandaloneOutcome(
	definition: WorkflowDefinition,
	result: ExecutionResult,
	subject: ModerationSubject,
	resolve: (ref: string) => ModerationOutcome,
): void {
	const failed = result.steps.flatMap((step) =>
		step.nodeKind === "rule" && step.status === "fail" && step.ruleRef
			? [
					{
						nodeId: step.nodeId,
						ref: step.ruleRef,
						outcome: resolve(step.ruleRef),
					},
				]
			: [],
	);
	const winner = failed.reduce<(typeof failed)[number] | null>(
		(best, next) =>
			best === null ||
			OUTCOME_PRIORITY[next.outcome] > OUTCOME_PRIORITY[best.outcome]
				? next
				: best,
		null,
	);
	if (!winner) return;

	const { outcome } = winner;
	const action =
		outcome === "warn"
			? "note"
			: outcome === "human-review"
				? "send-to-moderation"
				: outcome === "block" && subject === "issue"
					? "lock"
					: outcome;
	const paused = outcome === "human-review";
	const id = STANDALONE_OUTCOME_NODE;
	const at = new Date().toISOString();
	const params: Record<string, JsonValue> =
		outcome === "warn"
			? { message: "A repository rule flagged this contribution." }
			: {};
	definition.nodes.push({ id, type: "action", action, params });
	definition.edges.push({
		id: "e-moderation-outcome",
		from: winner.nodeId,
		to: id,
		when: "fail",
	});
	result.outcomes[id] = "pass";
	result.steps.push({
		nodeId: id,
		nodeKind: "action",
		status: paused ? "paused" : "pass",
		input: { action, params },
		output: standaloneModerationDecisionSchema.parse({
			outcome,
			ruleRef: winner.ref,
			failed,
		}),
		startedAt: at,
		finishedAt: at,
		durationMs: 0,
	});
	result.verdict =
		outcome === "warn"
			? "pass"
			: outcome === "human-review"
				? "needs_review"
				: outcome;
	if (paused) {
		result.pausedAtNodeId = id;
		result.pausedAtNodeIds.push(id);
	} else {
		result.actions.push({ nodeId: id, action, params });
	}
}
