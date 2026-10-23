import { captureMessage } from "@sentry/bun";

export interface UnrunnableWorkflow {
	repo: string;
	forge: string;
	workflowId: string;
	lintRule: string;
	scheduled: boolean;
	messages: string[];
}

export type ReportUnrunnable = (workflow: UnrunnableWorkflow) => void;

export function unrunnableEvent(workflow: UnrunnableWorkflow) {
	return {
		level: "error" as const,
		fingerprint: ["workflow-unrunnable", workflow.workflowId],
		tags: {
			repo: workflow.repo,
			forge: workflow.forge,
			workflow_id: workflow.workflowId,
			lint_rule: workflow.lintRule,
			scheduled: String(workflow.scheduled),
		},
		extra: { messages: workflow.messages },
	};
}

export function unrunnableReporter(
	capture: typeof captureMessage = captureMessage,
): ReportUnrunnable {
	return (workflow) => {
		capture("live workflow cannot run", unrunnableEvent(workflow));
	};
}

export const reportUnrunnableToSentry: ReportUnrunnable = unrunnableReporter();
