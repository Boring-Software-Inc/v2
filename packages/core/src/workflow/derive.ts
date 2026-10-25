import {
	DEFAULT_WORKFLOW,
	type Forge,
	type JsonValue,
	RULE_CATALOG,
	ruleIdOf,
	ruleSupportsForge,
	type WorkflowDefinition,
	type WorkflowEdge,
	type WorkflowNode,
} from "@tripwire/contracts";

/**
 * Derived default workflow (§6): for a repo with NO saved workflow, the
 * executed workflow IS a function of the rule toggles: "on change-request →
 * every ENABLED rule → all-of gate → block on fail". Nothing runs by default:
 * a repo with no enabled toggle derives a trigger-only workflow, which passes.
 * `DEFAULT_WORKFLOW` survives only for its id, name and trigger.
 *
 * Pure: the worker reads `rule_configs` and hands the toggles in.
 */
export interface RuleToggle {
	/** `id@version`, e.g. "account-age@1". */
	ref: string;
	enabled: boolean;
	config: JsonValue;
}

const CATALOG_ORDER: readonly string[] = RULE_CATALOG.map(
	(entry) => entry.ruleId,
);

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
	/**
	 * The forge this repo lives on. Rules the catalog declares unusable there are
	 * left OUT of the gate rather than added and skipped.
	 *
	 * Skipping is not free: a skipped rule trips the fail-closed floor, so a gate
	 * carrying even one structurally-inapplicable rule sends EVERY change request
	 * to review, forever. That is not caution, it is a dead gate — open-git ran
	 * exactly this way, degrading every pull request while english-only passed
	 * underneath. A rule that can never run on this forge is not a read that
	 * might come back; the catalog already settled it.
	 *
	 * Absent ⇒ no filtering, which keeps every existing caller unchanged.
	 */
	forge?: Forge,
): WorkflowDefinition {
	const runsHere = (ref: string): boolean =>
		!forge || ruleSupportsForge(ruleIdOf(ref), forge);

	const included: { ref: string; config: JsonValue }[] = [];
	const seen = new Set<string>();
	for (const toggle of toggles) {
		const id = ruleIdOf(toggle.ref);
		if (
			seen.has(id) ||
			excludeRuleIds?.has(id) ||
			!toggle.enabled ||
			!runsHere(toggle.ref)
		) {
			continue;
		}
		seen.add(id);
		included.push({ ref: toggle.ref, config: toggle.config });
	}
	const position = (ref: string): number => {
		const index = CATALOG_ORDER.indexOf(ruleIdOf(ref));
		return index === -1 ? CATALOG_ORDER.length : index;
	};
	included.sort(
		(a, b) => position(a.ref) - position(b.ref) || a.ref.localeCompare(b.ref),
	);

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
