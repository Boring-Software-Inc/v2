import {
	type CommentReason,
	DEFAULT_WORKFLOW,
	NOTE_FALLBACK,
	type OutcomeIssues,
	type OutcomeStep,
	runOutcomes,
	runSnapshotSchema,
	standaloneModerationWaiverSchema,
	stepLocalId,
} from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { moderationServices, runServices } from "@tripwire/db";
import { STANDALONE_OUTCOME_NODE } from "./standalone-moderation.ts";

export interface RunIssues {
	reasons: CommentReason[];
	issues: OutcomeIssues;
	standaloneOutcome: boolean;
	standaloneWarning: boolean;
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
	const decisionId = `${DEFAULT_WORKFLOW.id}:${STANDALONE_OUTCOME_NODE}`;
	const decision = steps
		.filter(
			(step) =>
				step.nodeId === decisionId || step.nodeId === `${decisionId}:resume`,
		)
		.at(-1);
	const waived = standaloneModerationWaiverSchema.safeParse(
		decision?.output,
	).success;
	return {
		standaloneOutcome:
			!waived && steps.some((step) => step.nodeId === decisionId),
		standaloneWarning:
			!waived && outcomes.notes.some((note) => note.nodeId === decisionId),
		reasons: reasons.filter(
			(reason) =>
				!(
					reason.stepId &&
					(outcomes.quietRuleStepIds.has(reason.stepId) ||
						(waived && reason.stepId.startsWith(`${DEFAULT_WORKFLOW.id}:`)))
				),
		),
		issues: {
			fixes: outcomes.fixes.map((fix) => ({
				message: fix.message,
				reasons: fix.message === null ? reasonsFor(fix.ruleStepIds) : [],
			})),
			notes: outcomes.notes
				.filter((note) => !waived || note.nodeId !== decisionId)
				.map((note) => note.message ?? NOTE_FALLBACK),
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
		return {
			reasons: [...reasons],
			issues: {},
			standaloneOutcome: false,
			standaloneWarning: false,
		};
	}
	const items = await moderationServices.listModerationItemsForRun(db, runId);
	return resolveRunIssues(
		runData.run.workflowSnapshot,
		runData.steps,
		reasons,
		items.some((item) => item.status === "pending"),
	);
}
