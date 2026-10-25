import {
	DEFAULT_RULE_OUTCOME_SETTING,
	NOTE_FALLBACK,
	RULE_OUTCOME_LABELS,
	type RuleOutcome,
	type RuleOutcomeSetting,
	ruleOutcomeSchema,
} from "@tripwire/contracts";

export const OUTCOME_LEAD = "When this does not pass";

export const RULE_OUTCOME_ITEMS = ruleOutcomeSchema.options.map((value) => ({
	value,
	label: RULE_OUTCOME_LABELS[value],
}));

export interface OutcomeLine {
	label: string;
	placeholder: string;
}

const OUTCOME_LINES: Partial<Record<RuleOutcome, OutcomeLine>> = {
	request_fix: {
		label: "Instruction",
		placeholder: "Change the target to main.",
	},
	note: { label: "Note", placeholder: NOTE_FALLBACK },
};

export function outcomeLine(outcome: RuleOutcome): OutcomeLine | null {
	return OUTCOME_LINES[outcome] ?? null;
}

export function isRuleOutcome(value: unknown): value is RuleOutcome {
	return ruleOutcomeSchema.safeParse(value).success;
}

export function withOutcome(
	current: RuleOutcomeSetting,
	outcome: RuleOutcome,
): RuleOutcomeSetting {
	return {
		outcome,
		instruction:
			outcomeLine(outcome) === outcomeLine(current.outcome)
				? current.instruction
				: "",
	};
}

export function withInstruction(
	current: RuleOutcomeSetting,
	instruction: string,
): RuleOutcomeSetting {
	return { ...current, instruction: instruction.trim() };
}

export function sameOutcome(
	a: RuleOutcomeSetting,
	b: RuleOutcomeSetting,
): boolean {
	return a.outcome === b.outcome && a.instruction === b.instruction;
}

export function outcomeSavedMessage(
	name: string,
	previous: RuleOutcomeSetting,
	next: RuleOutcomeSetting,
): string {
	if (previous.outcome !== next.outcome) {
		return `${name}: ${RULE_OUTCOME_LABELS[next.outcome]}`;
	}
	const line = outcomeLine(next.outcome);
	return `${name}: ${line ? `${line.label.toLowerCase()} saved` : "saved"}`;
}

export interface RuleOwnerView {
	id: string;
	name: string;
	exceptions?: string[];
}

export type OutcomeFooterState =
	| { kind: "managed"; owners: RuleOwnerView[] }
	| {
			kind: "standalone";
			setting: RuleOutcomeSetting;
			line: OutcomeLine | null;
	  };

export function outcomeFooterState(rule: {
	management: string;
	owners?: RuleOwnerView[];
	workflowId: string | null;
	outcome?: RuleOutcomeSetting;
}): OutcomeFooterState {
	const owners = rule.owners ?? [];
	if (rule.management === "managed" || owners.length > 0) {
		return {
			kind: "managed",
			owners:
				owners.length > 0
					? owners
					: rule.workflowId
						? [{ id: rule.workflowId, name: "a workflow" }]
						: [],
		};
	}
	const setting = rule.outcome ?? DEFAULT_RULE_OUTCOME_SETTING;
	return { kind: "standalone", setting, line: outcomeLine(setting.outcome) };
}
