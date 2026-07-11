/**
 * @tripwire/core — the pure engine. No I/O, no db, no forge, no AI SDK, no
 * octokit, no env vars. Effects arrive injected via RuleContext / generate().
 */
export type {
	AiReviewGenerate,
	AiReviewRequest,
	AiReviewResponse,
	ContextCommit,
	ContextContributor,
	ContextDiffFile,
	RuleContext,
} from "./context.ts";
export {
	defineRule,
	evaluateRule,
	type RuleDefinition,
	type RuleOutcome,
	ruleRef,
} from "./rules/define.ts";
export { getRule, listRules } from "./rules/registry.ts";
export { score } from "./scoring/score.ts";
export {
	clampSignalValue,
	SIGNAL_CATEGORIES,
	type Signal,
	type SignalCategory,
} from "./scoring/signals.ts";
export {
	type ExecutionResult,
	executeWorkflow,
	type NodeOutcome,
	type StepRecord,
} from "./workflow/executor.ts";
export {
	type ValidationResult,
	validateWorkflow,
} from "./workflow/validate.ts";
