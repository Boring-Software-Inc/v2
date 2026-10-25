import {
	DEFAULT_WORKFLOW,
	type Forge,
	type JsonValue,
	RULE_CATALOG,
	type RuleOutcomeSetting,
	ruleIdOf,
	ruleOutcomeAction,
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
	outcome?: RuleOutcomeSetting;
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

	const included: {
		ref: string;
		config: JsonValue;
		outcome?: RuleOutcomeSetting;
	}[] = [];
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
		included.push({
			ref: toggle.ref,
			config: toggle.config,
			outcome: toggle.outcome,
		});
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

	const grouped = (
		outcome: "block" | "human_review" | "close",
		gateId: string,
		actionNode: WorkflowNode,
	) => {
		const members = included.flatMap((rule, index) =>
			(rule.outcome?.outcome ?? "block") === outcome ? [index] : [],
		);
		if (members.length === 0) {
			return;
		}
		nodes.push({ id: gateId, type: "gate", mode: "all-of" });
		for (const index of members) {
			edges.push({
				id: outcome === "block" ? `g-${index}` : `${gateId}-${index}`,
				from: `rule-${index}`,
				to: gateId,
			});
		}
		nodes.push(actionNode);
		edges.push({
			id: outcome === "block" ? "e-block" : `e-${actionNode.id}`,
			from: gateId,
			to: actionNode.id,
			when: "fail",
		});
	};
	grouped("block", "gate", { id: "block", type: "action", action: "block" });
	grouped("close", "gate-close", {
		id: "close",
		type: "action",
		action: "close",
	});
	grouped("human_review", "gate-review", {
		id: "review",
		type: "action",
		action: "send-to-moderation",
	});
	included.forEach((rule, index) => {
		const outcome = rule.outcome?.outcome;
		if (outcome !== "request_fix" && outcome !== "note") {
			return;
		}
		const { action, params } = ruleOutcomeAction(
			rule.outcome ?? {
				outcome,
				instruction: "",
			},
		);
		const id = `${outcome === "note" ? "note" : "fix"}-${index}`;
		nodes.push(
			params
				? { id, type: "action", action, params }
				: { id, type: "action", action },
		);
		edges.push({ id: `e-${id}`, from: `rule-${index}`, to: id, when: "fail" });
	});

	return {
		id: DEFAULT_WORKFLOW.id,
		name: DEFAULT_WORKFLOW.name,
		version: DEFAULT_WORKFLOW.version,
		nodes,
		edges,
	};
}
