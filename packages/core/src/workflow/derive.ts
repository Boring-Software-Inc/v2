import {
	DEFAULT_WORKFLOW,
	type JsonValue,
	ruleIdOf,
	type WorkflowDefinition,
	type WorkflowEdge,
	type WorkflowNode,
} from "@tripwire/contracts";

/**
 * Derived default workflow (§6): for a repo with NO saved workflow, the
 * executed workflow IS a function of the rule toggles — "on change-request →
 * every ENABLED rule → all-of gate → block on fail". This retires
 * `DEFAULT_WORKFLOW` as an executed constant; the contracts constant survives
 * only as the BASELINE rule set (and a test fixture).
 *
 * Overlay rules (live-test surprise #1 — toggles were cosmetic before this):
 * - baseline rules (the hand-seeded default gate) run UNLESS a toggle disables
 *   them — a fresh repo with no rule_configs keeps the boring default gate;
 * - a toggle that DISABLES a baseline rule drops it from the derived graph;
 * - a toggle's config overrides the baseline config;
 * - an ENABLED toggle for a non-baseline rule opts that rule in.
 *
 * Pure: the worker reads `rule_configs` and hands the toggles in.
 */
export interface RuleToggle {
	/** `id@version`, e.g. "account-age@1". */
	ref: string;
	enabled: boolean;
	config: JsonValue;
}

interface BaselineRule {
	ref: string;
	config: JsonValue;
}

function baselineRules(): BaselineRule[] {
	const rules: BaselineRule[] = [];
	for (const node of DEFAULT_WORKFLOW.nodes) {
		if (node.type === "rule") {
			rules.push({ ref: node.ref, config: node.config });
		}
	}
	return rules;
}

function baselineTrigger(): WorkflowNode {
	const trigger = DEFAULT_WORKFLOW.nodes.find((n) => n.type === "trigger");
	if (trigger) {
		return trigger;
	}
	return {
		id: "trigger",
		type: "trigger",
		kinds: ["change-request.opened", "change-request.updated"],
	};
}

export function deriveDefaultWorkflow(
	toggles: RuleToggle[],
	/**
	 * Rule ids already owned by an enabled saved workflow. Saved workflows
	 * orchestrate the rules they contain — they do NOT turn the rest off — so
	 * the worker derives the default over the LEFTOVER rules and runs it
	 * alongside. Excluding owned ids here is what keeps a rule from running
	 * twice with two configs (the workflow node's config wins for owned rules).
	 */
	excludeRuleIds?: ReadonlySet<string>,
): WorkflowDefinition {
	// Key by rule ID, not full ref (§6 b): a repo has ONE config per rule, and a
	// toggle whose version differs from the baseline's (a repo HELD on an older
	// version) must REPLACE the baseline entry — never run alongside it. The
	// toggle's ref (current when auto-advanced, pinned when held) wins.
	const byId = new Map(toggles.map((t) => [ruleIdOf(t.ref), t]));
	const baseline = baselineRules();
	const baselineIds = new Set(baseline.map((r) => ruleIdOf(r.ref)));

	const included: BaselineRule[] = [];
	for (const rule of baseline) {
		const id = ruleIdOf(rule.ref);
		if (excludeRuleIds?.has(id)) {
			continue;
		}
		const toggle = byId.get(id);
		if (toggle && !toggle.enabled) {
			continue;
		}
		included.push({
			ref: toggle?.ref ?? rule.ref,
			config: toggle?.config ?? rule.config,
		});
	}
	for (const toggle of toggles) {
		if (excludeRuleIds?.has(ruleIdOf(toggle.ref))) {
			continue;
		}
		if (toggle.enabled && !baselineIds.has(ruleIdOf(toggle.ref))) {
			included.push({ ref: toggle.ref, config: toggle.config });
		}
	}

	const trigger = baselineTrigger();
	const nodes: WorkflowNode[] = [trigger];
	const edges: WorkflowEdge[] = [];
	included.forEach((rule, index) => {
		const id = `rule-${index}`;
		nodes.push({ id, type: "rule", ref: rule.ref, config: rule.config });
		edges.push({ id: `t-${index}`, from: trigger.id, to: id });
	});

	// Every rule disabled ⇒ trigger-only workflow: nothing to gate ⇒ pass.
	if (included.length > 0) {
		nodes.push({ id: "gate", type: "gate", mode: "all-of" });
		included.forEach((_rule, index) => {
			edges.push({ id: `g-${index}`, from: `rule-${index}`, to: "gate" });
		});
		nodes.push({ id: "block", type: "action", action: "block" });
		edges.push({ id: "e-block", from: "gate", to: "block", when: "fail" });
	}

	return {
		id: DEFAULT_WORKFLOW.id,
		name: DEFAULT_WORKFLOW.name,
		version: DEFAULT_WORKFLOW.version,
		nodes,
		edges,
	};
}
