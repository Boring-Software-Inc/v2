/**
 * MOVED to @tripwire/contracts (workflow-validate.ts) so the web editor can
 * run the same validator live — core is worker-only by the §3 arrows, and the
 * validator is pure zod+graph logic. Re-exported here so core-internal
 * imports keep working unchanged.
 */
export {
	type ValidationIssue,
	type ValidationResult,
	validateWorkflow,
	validateWorkflowForEnable,
} from "@tripwire/contracts";
