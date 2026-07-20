import type { WorkflowDefinition } from "@tripwire/contracts";
import type { JsonValue, RunStepView } from "#/lib/runs.functions";

/**
 * Planned rule nodes from the run snapshot that have not finished yet.
 * While status is queued/running, the run page merges these as pending
 * rows so the user sees the full queue, not a blank "evaluating…".
 */
export function pendingRuleStepsFromSnapshot(
	snapshot: JsonValue,
	completed: readonly Pick<RunStepView, "nodeId" | "ruleRef">[],
): RunStepView[] {
	const done = new Set(completed.filter((s) => s.ruleRef).map((s) => s.nodeId));
	const defs = Array.isArray(snapshot)
		? (snapshot as WorkflowDefinition[])
		: [];
	const pending: RunStepView[] = [];
	const now = new Date(0).toISOString();
	for (const def of defs) {
		if (!def || typeof def !== "object" || !Array.isArray(def.nodes)) {
			continue;
		}
		const defId = typeof def.id === "string" ? def.id : "default@1";
		for (const node of def.nodes) {
			if (!node || node.type !== "rule" || typeof node.ref !== "string") {
				continue;
			}
			const nodeId = `${defId}:${node.id}`;
			if (done.has(nodeId)) {
				continue;
			}
			pending.push({
				id: `pending:${nodeId}`,
				nodeId,
				nodeKind: "rule",
				ruleRef: node.ref,
				status: "pending",
				evidence: null,
				output: null,
				durationMs: 0,
				startedAt: now,
				publicEvidence: null,
				summary: null,
			});
		}
	}
	return pending;
}

/** Finished steps first (as stored), then remaining planned rules as pending. */
export function mergeLiveSteps(
	status: string,
	snapshot: JsonValue,
	steps: RunStepView[],
): RunStepView[] {
	if (status !== "queued" && status !== "running") {
		return steps;
	}
	return [...steps, ...pendingRuleStepsFromSnapshot(snapshot, steps)];
}
