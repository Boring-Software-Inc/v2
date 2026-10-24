import { z } from "zod";
import { workflowDefinitionSchema } from "./workflow.ts";
import type { LintRuleId, LintSeverity } from "./workflow-lint.ts";
import { issuesInState } from "./workflow-validate.ts";

export const WORKFLOW_PUSH_STATUSES = [
	"pending",
	"accepted",
	"rejected",
	"expired",
	"stale",
] as const;

export const workflowPushStatusSchema = z.enum(WORKFLOW_PUSH_STATUSES);

export type WorkflowPushStatus = z.infer<typeof workflowPushStatusSchema>;

export const WORKFLOW_PUSH_TTL_MS = 60 * 60 * 1000;

export const WORKFLOW_PUSH_MAX_WAIT_SECONDS = 25;

export const WORKFLOW_PUSH_DECISIONS = ["accept", "reject"] as const;

export const workflowPushDecisionSchema = z.enum(WORKFLOW_PUSH_DECISIONS);

export type WorkflowPushDecision = z.infer<typeof workflowPushDecisionSchema>;

export const workflowPushEntrySchema = z.object({
	definition: workflowDefinitionSchema,
	baseWorkflowId: z.string().nullable(),
	baseHash: z.string().nullable(),
});

export type WorkflowPushEntry = z.infer<typeof workflowPushEntrySchema>;

export const workflowPushEntriesSchema = z
	.array(workflowPushEntrySchema)
	.min(1);

export const workflowPushOutcomeSchema = z.object({
	id: z.string(),
	name: z.string(),
	outcome: z.enum(["created", "updated"]),
	workflowId: z.string(),
});

export type WorkflowPushOutcome = z.infer<typeof workflowPushOutcomeSchema>;

export const workflowPushOutcomesSchema = z.array(workflowPushOutcomeSchema);

export const workflowPushChangeSchema = z.enum(["new", "changed"]);

export type WorkflowPushChange = z.infer<typeof workflowPushChangeSchema>;

export const workflowPushViewSchema = z.object({
	id: z.string(),
	org: z.string(),
	repo: z.string(),
	status: workflowPushStatusSchema,
	url: z.string(),
	expiresAt: z.string(),
	workflows: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			change: workflowPushChangeSchema,
			outcome: z.enum(["created", "updated"]).optional(),
			url: z.string().optional(),
		}),
	),
});

export type WorkflowPushView = z.infer<typeof workflowPushViewSchema>;

export const WORKFLOW_PUSH_STATUS_LABELS: Record<WorkflowPushStatus, string> = {
	pending: "Waiting for review",
	accepted: "Accepted",
	rejected: "Rejected",
	expired: "Expired",
	stale: "Out of date",
};

export function effectivePushStatus(input: {
	status: WorkflowPushStatus;
	expiresAt: Date;
	now: Date;
	drifted: boolean;
}): WorkflowPushStatus {
	if (input.status !== "pending") {
		return input.status;
	}
	if (input.now.getTime() >= input.expiresAt.getTime()) {
		return "expired";
	}
	return input.drifted ? "stale" : "pending";
}

export function pushExitCode(status: WorkflowPushStatus): 0 | 1 {
	return status === "accepted" ? 0 : 1;
}

export function pushBlockingIssues<
	T extends { rule?: LintRuleId; severity?: LintSeverity },
>(issues: readonly T[], enabled: boolean): T[] {
	return enabled
		? issuesInState(issues, enabled).filter(
				(issue) => issue.severity === "error",
			)
		: [];
}
