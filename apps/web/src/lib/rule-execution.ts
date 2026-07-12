import { DEFAULT_WORKFLOW } from "@tripwire/contracts";

/**
 * The baseline rule set — the rule refs in the hand-seeded default gate. A
 * repo with NO explicit `rule_configs` row for one of these still RUNS it
 * (derive.ts overlay semantics, §6). Kept in lockstep with
 * `core/workflow/derive.ts#baselineRules` via the shared `DEFAULT_WORKFLOW`.
 */
export const BASELINE_RULE_REFS: ReadonlySet<string> = new Set(
	DEFAULT_WORKFLOW.nodes
		.filter((node) => node.type === "rule")
		.map((node) => node.ref),
);

/**
 * Whether a rule ACTUALLY executes for a repo with no saved workflow, matching
 * `deriveDefaultWorkflow`: an explicit toggle wins; absent, a baseline rule
 * runs and a non-baseline rule does not. This is the honest display state for
 * the /rules toggle — a fresh repo runs its baseline rules even with an empty
 * `rule_configs`, which the old `enabled ?? false` under-reported (§6, Unit 2
 * residual).
 */
export function ruleExecutes(
	ref: string,
	explicitEnabled: boolean | undefined,
): boolean {
	if (explicitEnabled !== undefined) {
		return explicitEnabled;
	}
	return BASELINE_RULE_REFS.has(ref);
}
