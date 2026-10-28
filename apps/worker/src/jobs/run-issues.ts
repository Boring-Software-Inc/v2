import {
	type CommentReason,
	NOTE_FALLBACK,
	type OutcomeIssues,
	type OutcomeStep,
	runOutcomes,
	runSnapshotSchema,
	stepLocalId,
} from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { moderationServices, runServices } from "@tripwire/db";

export interface RunIssues {
	reasons: CommentReason[];
	issues: OutcomeIssues;
}

export function reasonStepId(nodeId: string): string {
	const index = nodeId.indexOf(":");
	if (index === -1) {
		return nodeId;
	}
	const definitionId = nodeId.slice(0, index);
	return `${definitionId}:${stepLocalId(nodeId, definitionId) ?? ""}`;
}

export function resolveRunIssues(
	snapshot: Parameters<typeof runSnapshotSchema.parse>[0],
	steps: readonly OutcomeStep[],
	reasons: readonly CommentReason[],
	reviewPending: boolean,
): RunIssues {
	const outcomes = runOutcomes(runSnapshotSchema.parse(snapshot), steps);
	const reasonsFor = (stepIds: readonly string[]): CommentReason[] =>
		reasons.filter(
			(reason) =>
				reason.stepId !== undefined && stepIds.includes(reason.stepId),
		);
	return {
		reasons: reasons.filter(
			(reason) =>
				!(reason.stepId && outcomes.quietRuleStepIds.has(reason.stepId)),
		),
		issues: {
			fixes: outcomes.fixes.map((fix) => ({
				message: fix.message,
				reasons: fix.message === null ? reasonsFor(fix.ruleStepIds) : [],
			})),
			notes: outcomes.notes.map((note) => note.message ?? NOTE_FALLBACK),
			reviewPending,
		},
	};
}

export async function loadRunIssues(
	db: Db,
	runId: string,
	reasons: readonly CommentReason[],
): Promise<RunIssues> {
	const runData = await runServices.getRunWithSteps(db, runId);
	if (!runData) {
		return { reasons: [...reasons], issues: {} };
	}
	const items = await moderationServices.listModerationItemsForRun(db, runId);
	return resolveRunIssues(
		runData.run.workflowSnapshot,
		runData.steps,
		reasons,
		items.some((item) => item.status === "pending"),
	);
}
