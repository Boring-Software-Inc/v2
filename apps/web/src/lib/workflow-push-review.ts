import {
	stripWorkflowSecrets,
	validationIssueText,
	type WorkflowDefinition,
	type WorkflowPushChange,
	type WorkflowPushStatus,
	workflowKeys,
	workflowToCode,
} from "@tripwire/contracts";

export interface PushReviewIssue {
	severity: "error" | "warning";
	step: string;
	message: string;
}

export interface PushReviewSource {
	id: string;
	name: string;
	change: WorkflowPushChange;
	enabled: boolean;
	stale: boolean;
	before: WorkflowDefinition | null;
	after: WorkflowDefinition;
	issues: readonly PushReviewIssue[];
	blocking: readonly string[];
}

export type PushReviewCode =
	| { kind: "code"; before: string; after: string }
	| { kind: "refused"; reason: string };

export interface PushReviewWorkflow {
	id: string;
	name: string;
	change: WorkflowPushChange;
	enabled: boolean;
	stale: boolean;
	code: PushReviewCode;
	errors: string[];
	warnings: string[];
	blocking: string[];
}

function codeOf(entry: PushReviewSource): PushReviewCode {
	if (
		entry.before?.authoredSource !== undefined ||
		entry.after.authoredSource !== undefined
	) {
		const reviewText = (definition: WorkflowDefinition) => {
			const { authoredSource, ...graph } = stripWorkflowSecrets(definition);
			const compiled = JSON.stringify(graph, null, "\t")
				.split("\n")
				.map((line) => `// ${line}`)
				.join("\n");
			return `${authoredSource ?? "// This workflow has no saved TypeScript source."}\n\n// Compiled graph sent to Tripwire\n${compiled}\n`;
		};
		return {
			kind: "code",
			before: entry.before ? reviewText(entry.before) : "",
			after: reviewText(entry.after),
		};
	}
	const named = entry.before ?? entry.after;
	const key = workflowKeys([named]).get(named.id);
	const after = workflowToCode(entry.after, { key });
	if (!after.ok) {
		return { kind: "refused", reason: after.reason };
	}
	if (!entry.before) {
		return { kind: "code", before: "", after: after.code };
	}
	const before = workflowToCode(entry.before, { key });
	return before.ok
		? { kind: "code", before: before.code, after: after.code }
		: { kind: "refused", reason: before.reason };
}

export function pushReviewWorkflow(
	entry: PushReviewSource,
): PushReviewWorkflow {
	const blocking = new Set(entry.blocking);
	return {
		id: entry.id,
		name: entry.name,
		change: entry.change,
		enabled: entry.enabled,
		stale: entry.stale,
		code: codeOf(entry),
		errors: entry.issues
			.filter((issue) => issue.severity === "error")
			.map(validationIssueText)
			.filter((text) => !blocking.has(text)),
		warnings: entry.issues
			.filter((issue) => issue.severity === "warning")
			.map(validationIssueText),
		blocking: [...entry.blocking],
	};
}

export type PushReviewState =
	| "open"
	| "blocked"
	| "stale"
	| "accepted"
	| "rejected"
	| "expired";

export function pushReviewState(
	status: WorkflowPushStatus,
	blocked: boolean,
): PushReviewState {
	if (status === "pending") {
		return blocked ? "blocked" : "open";
	}
	return status;
}

export function canDecide(state: PushReviewState): boolean {
	return state === "open" || state === "blocked";
}

export function canAccept(state: PushReviewState): boolean {
	return state === "open";
}
