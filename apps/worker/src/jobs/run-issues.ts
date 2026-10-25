import {
	type CommentReason,
	NOTE_FALLBACK,
	type OutcomeIssues,
	runOutcomes,
	runSnapshotSchema,
	stepLocalId,
} from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { moderationServices, runServices } from "@tripwire/db";

export const FIX_FALLBACK = "Fix what this rule found.";

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
	snapshot: unknown,
	steps: readonly {
		nodeId: string;
		nodeKind: string;
		status: string;
		input?: unknown;
		output?: unknown;
	}[],
	reasons: readonly CommentReason[],
	reviewPending: boolean,
): RunIssues {
	const outcomes = runOutcomes(runSnapshotSchema.parse(snapshot), steps);
	const textFor = (stepIds: readonly string[], fallback: string): string => {
		const texts = reasons
			.filter((reason) => reason.stepId && stepIds.includes(reason.stepId))
			.map((reason) => reason.text);
		return texts.length > 0 ? texts.join(" ") : fallback;
	};
	return {
		reasons: reasons.filter(
			(reason) =>
				!(reason.stepId && outcomes.quietRuleStepIds.has(reason.stepId)),
		),
		issues: {
			fixes: outcomes.fixes.map(
				(fix) => fix.message ?? textFor(fix.ruleStepIds, FIX_FALLBACK),
			),
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
