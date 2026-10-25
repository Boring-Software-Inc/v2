import { z } from "zod";
import type { Verdict } from "./runs.ts";
import {
	type JsonValue,
	MAX_OUTCOME_MESSAGE,
	type WorkflowActionKind,
} from "./workflow.ts";

export const ruleOutcomeSchema = z.enum([
	"block",
	"request_fix",
	"human_review",
	"note",
	"close",
]);
export type RuleOutcome = z.infer<typeof ruleOutcomeSchema>;

export const DEFAULT_RULE_OUTCOME: RuleOutcome = "block";

export const RULE_OUTCOME_LABELS = {
	block: "Block",
	request_fix: "Ask author to fix",
	human_review: "Human review",
	note: "Note only",
	close: "Close",
} as const satisfies Record<RuleOutcome, string>;

export const RULE_OUTCOME_ACTIONS = {
	block: "block",
	request_fix: "request-fix",
	human_review: "send-to-moderation",
	note: "note",
	close: "close",
} as const satisfies Record<RuleOutcome, WorkflowActionKind>;

export const ruleOutcomeSettingSchema = z.object({
	outcome: ruleOutcomeSchema.default(DEFAULT_RULE_OUTCOME),
	instruction: z
		.string()
		.trim()
		.max(MAX_OUTCOME_MESSAGE, `keep it under ${MAX_OUTCOME_MESSAGE} characters`)
		.default(""),
});
export type RuleOutcomeSetting = z.infer<typeof ruleOutcomeSettingSchema>;

export const DEFAULT_RULE_OUTCOME_SETTING: RuleOutcomeSetting = {
	outcome: DEFAULT_RULE_OUTCOME,
	instruction: "",
};

export function readRuleOutcome(input: {
	outcome?: string | null;
	instruction?: string | null;
}): RuleOutcomeSetting {
	const parsed = ruleOutcomeSettingSchema.safeParse({
		outcome: input.outcome ?? undefined,
		instruction: input.instruction ?? undefined,
	});
	return parsed.success ? parsed.data : DEFAULT_RULE_OUTCOME_SETTING;
}

export function ruleOutcomeAction(setting: RuleOutcomeSetting): {
	action: WorkflowActionKind;
	params?: Record<string, JsonValue>;
} {
	const action = RULE_OUTCOME_ACTIONS[setting.outcome];
	const message = setting.instruction.trim();
	if (
		(setting.outcome === "request_fix" || setting.outcome === "note") &&
		message !== ""
	) {
		return { action, params: { message } };
	}
	return { action };
}

export const NOTE_FALLBACK = "No description provided.";

export const VERDICT_RANK = {
	pass: 0,
	needs_review: 1,
	changes_required: 2,
	block: 3,
	close: 4,
} as const satisfies Record<Verdict, number>;

export function joinVerdicts(verdicts: readonly Verdict[]): Verdict {
	return verdicts.reduce<Verdict>(
		(worst, verdict) =>
			VERDICT_RANK[verdict] > VERDICT_RANK[worst] ? verdict : worst,
		"pass",
	);
}

export interface RunStanding {
	closes: number;
	blocks: number;
	fixes: number;
	reviewsPending: number;
}

export function standingVerdict(standing: RunStanding): Verdict {
	if (standing.closes > 0) {
		return "close";
	}
	if (standing.blocks > 0) {
		return "block";
	}
	if (standing.fixes > 0) {
		return "changes_required";
	}
	if (standing.reviewsPending > 0) {
		return "needs_review";
	}
	return "pass";
}
