import type { CommentReason, CustomRuleRecord } from "@tripwire/contracts";
import { customRuleSummary } from "@tripwire/contracts";
import { getRule } from "@tripwire/core";

/**
 * The failing rules' reasons for the PR comment (§7/§12). Built in the WORKER —
 * the only legal importer of core — from each rule step's stored RuleResult
 * envelope: the rule's own `summarize` gives the one-liner, `remedy` picks the
 * "how do i fix this?" body, and a wait-rule's `waitHint` derives the
 * threshold-free remainder. Never a rule count — a stranger can't read "1 of 8".
 */

interface ReasonStep {
	nodeKind: string;
	status: string;
	/** The RuleResult envelope: { ruleId, version, evidence, … }. */
	output: unknown;
}

interface RuleEnvelope {
	ruleId?: unknown;
	version?: unknown;
	evidence?: unknown;
}

function asEnvelope(output: unknown): RuleEnvelope | null {
	return output && typeof output === "object" ? (output as RuleEnvelope) : null;
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
		const env = asEnvelope(step.output);
		if (!env || typeof env.ruleId !== "string") {
			continue;
		}
		const ref = `${env.ruleId}@${env.version}`;
		const rule = getRule(ref);
		const evidence = env.evidence;
		// Custom rules aren't in the code registry: their one-liner comes from
		// customRuleSummary over the observed value (§10-safe — observed only, no
		// threshold), same slot a built-in's summarize() fills. The fallback names
		// the rule, never the bare generated ref.
		const custom = customRecords?.get(ref);
		const observed =
			evidence && typeof evidence === "object" && "observed" in evidence
				? (evidence as { observed: unknown }).observed
				: null;
		const text =
			(rule?.summarize && evidence ? rule.summarize(evidence) : null) ??
			(custom && observed !== null
				? customRuleSummary(custom.definition, observed)
				: null) ??
			`${custom?.name ?? env.ruleId} failed`;
		const remedy = rule?.remedy ?? "revise";
		const waitHint =
			remedy === "wait" && rule?.waitHint && evidence
				? rule.waitHint(evidence)
				: null;
		// ruleId rides along so non-full comment modes can resolve the catalog's
		// contributorLabel; full mode never reads it.
		reasons.push({ text, remedy, waitHint, ruleId: env.ruleId });
	}
	return reasons;
}
