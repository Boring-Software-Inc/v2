import type { CommentReason, CustomRuleRecord } from "@tripwire/contracts";
import {
	commentObservedEvidenceSchema,
	commentRuleEnvelopeSchema,
	customRuleSummary,
	ruleDisplayName,
} from "@tripwire/contracts";
import { getRule } from "@tripwire/core";
import { reasonStepId } from "./run-issues.ts";

/**
 * The failing rules' reasons for the PR comment (§7/§12). Built in the WORKER —
 * the only legal importer of core — from each rule step's stored RuleResult
 * envelope: the rule's own `summarize` gives the one-liner, `remedy` picks the
 * "how do i fix this?" body, and a wait-rule's `waitHint` derives the
 * threshold-free remainder. Never a rule count — a stranger can't read "1 of 8".
 */

interface ReasonStep {
	nodeId?: string;
	nodeKind: string;
	status: string;
	/** The RuleResult envelope: { ruleId, version, evidence, … }. */
	output: unknown;
}

export function buildCommentReasons(
	steps: ReasonStep[],
	customRecords?: Map<string, CustomRuleRecord>,
): CommentReason[] {
	const reasons: CommentReason[] = [];
	for (const step of steps) {
		if (step.nodeKind !== "rule" || step.status !== "fail") {
			continue;
		}
		const parsed = commentRuleEnvelopeSchema.safeParse(step.output);
		if (!parsed.success || parsed.data.ruleId === undefined) {
			continue;
		}
		const env = parsed.data;
		const ref = `${env.ruleId}@${env.version}`;
		const rule = getRule(ref);
		const evidence = env.evidence;
		// Custom rules aren't in the code registry: their one-liner comes from
		// customRuleSummary over the observed value (§10-safe — observed only, no
		// threshold), same slot a built-in's summarize() fills. The fallback names
		// the rule, never the bare generated ref.
		const custom = customRecords?.get(ref);
		const observedEvidence = commentObservedEvidenceSchema.safeParse(evidence);
		const observed = observedEvidence.success
			? observedEvidence.data.observed
			: null;
		const text =
			(rule?.summarize && evidence ? rule.summarize(evidence, false) : null) ??
			(custom && observed !== null
				? customRuleSummary(custom.definition, observed)
				: null) ??
			"It does not meet this rule.";
		const remedy = rule?.remedy ?? "revise";
		const hintFor = remedy === "wait" ? rule?.waitHint : rule?.fixHint;
		const hint = hintFor && evidence ? hintFor(evidence) : null;
		const reason: CommentReason = {
			text,
			remedy,
			hint,
			ruleId: parsed.data.ruleId,
			ruleName: custom?.name ?? ruleDisplayName(parsed.data.ruleId),
		};
		if (step.nodeId) {
			reason.stepId = reasonStepId(step.nodeId);
		}
		reasons.push(reason);
	}
	return reasons;
}
