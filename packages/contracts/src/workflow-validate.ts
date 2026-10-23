import { RULE_CATALOG } from "./rules.ts";
import type { WorkflowDefinition } from "./workflow.ts";
import {
	type LintFix,
	type LintResult,
	type LintRuleId,
	type LintSeverity,
	lintWorkflowReport,
	type ValidationCatalogEntry,
} from "./workflow-lint.ts";

export interface ValidationIssue {
	rule?: LintRuleId;
	severity?: LintSeverity;
	step?: string;
	nodeId?: string;
	edgeId?: string;
	message: string;
	fixes?: LintFix[];
}

/** An issue as one sentence that names its step. */
export function validationIssueText(issue: ValidationIssue): string {
	const text = /[.?]$/.test(issue.message)
		? issue.message
		: `${issue.message}.`;
	return issue.step ? `${issue.step}: ${text}` : text;
}

export type ValidationResult =
	| { valid: true; definition: WorkflowDefinition }
	| { valid: false; issues: LintResult[] };

/**
 * Structural validation of a workflow DAG (§6): schema shape, unique ids,
 * edges reference real nodes, `not` gates take exactly one input, moderation
 * resume edges only leave send-to-moderation nodes, at least one trigger, and
 * NO cycles — the executor's topo walk depends on it.
 *
 * Lives in contracts (moved from core) so the web editor can run it live —
 * core is worker-only by the §3 arrows; this is pure zod+graph logic, which is
 * exactly what contracts may hold. Core re-exports it unchanged.
 */
export function validateWorkflow(input: unknown): ValidationResult {
	return toResult(input as WorkflowDefinition, RULE_CATALOG, "structure");
}

export function validateWorkflowForEnable(
	input: unknown,
	catalog: readonly ValidationCatalogEntry[] = RULE_CATALOG,
): ValidationResult {
	return toResult(input as WorkflowDefinition, catalog, "enable");
}

function toResult(
	input: WorkflowDefinition,
	catalog: readonly ValidationCatalogEntry[],
	stage: "structure" | "enable",
): ValidationResult {
	const report = lintWorkflowReport(input, {
		catalog,
		stage,
	});
	const errors = report.results.filter((issue) => issue.severity === "error");
	if (errors.length > 0 || !report.definition) {
		return { valid: false, issues: errors };
	}
	return { valid: true, definition: report.definition };
}

const UNRUNNABLE_RULES: ReadonlySet<LintRuleId> = new Set<LintRuleId>([
	"cycle",
	"gate-input",
	"not-input",
	"trigger-input",
	"wrong-output",
	"no-outputs",
	"missing-step",
	"duplicate-id",
	"rule-unavailable",
]);

export function unrunnableIssues(input: WorkflowDefinition): LintResult[] {
	return workflowReadiness(input).issues.filter((issue) =>
		UNRUNNABLE_RULES.has(issue.rule),
	);
}

export interface WorkflowReadiness {
	runnable: boolean;
	canTurnOn: boolean;
	issues: LintResult[];
}

export function workflowReadiness(
	definition: WorkflowDefinition,
	catalog: readonly ValidationCatalogEntry[] = RULE_CATALOG,
): WorkflowReadiness {
	const report = lintWorkflowReport(definition, {
		catalog,
		stage: "enable",
	});
	const issues = report.results.filter((issue) => issue.severity === "error");
	if (!report.definition) {
		return { runnable: false, canTurnOn: false, issues };
	}
	return {
		runnable: !issues.some((issue) => UNRUNNABLE_RULES.has(issue.rule)),
		canTurnOn: issues.length === 0,
		issues,
	};
}

export type WorkflowState =
	| "on"
	| "off"
	| "cant-run"
	| "needs-fixes"
	| "cant-turn-on";

export const WORKFLOW_STATE_LABELS = {
	on: "Live",
	off: "Off",
	"cant-run": "Can't run",
	"needs-fixes": "Needs fixes",
	"cant-turn-on": "Can't turn on",
} as const satisfies Record<WorkflowState, string>;

export function workflowState(input: {
	enabled: boolean;
	runnable: boolean;
	canTurnOn: boolean;
}): WorkflowState {
	if (input.enabled) {
		if (!input.runnable) {
			return "cant-run";
		}
		return input.canTurnOn ? "on" : "needs-fixes";
	}
	return input.canTurnOn ? "off" : "cant-turn-on";
}
