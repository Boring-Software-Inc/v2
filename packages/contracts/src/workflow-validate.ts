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
	nodeId?: string;
	edgeId?: string;
	message: string;
	fixes?: LintFix[];
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
