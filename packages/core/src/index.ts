/**
 * @tripwire/core — the pure engine. No I/O, no db, no forge, no AI SDK, no
 * octokit, no env vars. Effects arrive injected via RuleContext / generate().
 */
export type {
	AiReviewGenerate,
	AiReviewRequest,
	AiReviewResponse,
	AiReviewUnavailable,
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
export { maintainerLine } from "./rules/maintainer-line.ts";
export {
	getRule,
	listRules,
	PUBLIC_VIEW_OPT_OUT,
	projectRulePublic,
	type RulePublicProjection,
} from "./rules/registry.ts";
export {
	deriveDefaultWorkflow,
	type RuleToggle,
} from "./workflow/derive.ts";
export {
	type ExecutionResult,
	executeWorkflow,
	type StepRecord,
} from "./workflow/executor.ts";
export {
	type ValidationResult,
	validateWorkflow,
} from "./workflow/validate.ts";
