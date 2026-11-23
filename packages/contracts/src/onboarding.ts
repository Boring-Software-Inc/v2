import { z } from "zod";
import { forgeIdSchema } from "./forges.ts";
import { RULE_PACKS } from "./rule-packs.ts";
import { RULE_CATALOG } from "./rules.ts";
import type {
	JsonValue,
	WorkflowDefinition,
	WorkflowEdge,
	WorkflowNode,
} from "./workflow.ts";

/**
 * The first-run onboarding a new user walks before landing in a workspace.
 * The URL holds the visible step; `user_onboarding` holds progress and answers.
 */
export const ONBOARDING_STEPS = [
	"welcome",
	"problems",
	"about",
	"workspace",
	"connect",
	"rules",
	"check",
	"responses",
	"workflow",
	"agents",
] as const;
export const onboardingStepSchema = z.enum(ONBOARDING_STEPS);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const onboardingStatusSchema = z.enum([
	"in_progress",
	"completed",
	"skipped",
]);
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;

export const ONBOARDING_INTENTS = [
	"drive-by-slop",
	"new-accounts",
	"floods",
	"crypto-spam",
	"workflow-tampering",
	"mass-changes",
	"off-language",
	"not-sure",
] as const;
export const onboardingIntentSchema = z.enum(ONBOARDING_INTENTS);
export type OnboardingIntent = z.infer<typeof onboardingIntentSchema>;

export const ONBOARDING_USAGES = ["team", "personal"] as const;
export const onboardingUsageSchema = z.enum(ONBOARDING_USAGES);
export type OnboardingUsage = z.infer<typeof onboardingUsageSchema>;

export const ONBOARDING_ROLES = [
	"maintainer",
	"founder",
	"engineering-lead",
	"security",
	"devrel",
	"other",
] as const;
export const onboardingRoleSchema = z.enum(ONBOARDING_ROLES);
export type OnboardingRole = z.infer<typeof onboardingRoleSchema>;

export const ONBOARDING_TEAM_SIZES = [
	"solo",
	"2-10",
	"11-50",
	"51-200",
	"200-plus",
] as const;
export const onboardingTeamSizeSchema = z.enum(ONBOARDING_TEAM_SIZES);
export type OnboardingTeamSize = z.infer<typeof onboardingTeamSizeSchema>;

export const ONBOARDING_REFERRALS = [
	"x",
	"github",
	"hacker-news",
	"reddit",
	"bluesky",
	"youtube",
	"discord",
	"linkedin",
	"friend",
] as const;
export const onboardingReferralSchema = z.enum(ONBOARDING_REFERRALS);
export type OnboardingReferral = z.infer<typeof onboardingReferralSchema>;

/** Change requests the user reported in the `check` step, at most a handful. */
export const ONBOARDING_MAX_REPORTED = 5;

export const onboardingAnswersSchema = z.object({
	intents: z.array(onboardingIntentSchema).max(ONBOARDING_INTENTS.length),
	usage: onboardingUsageSchema.nullable(),
	role: onboardingRoleSchema.nullable(),
	teamSize: onboardingTeamSizeSchema.nullable(),
	referral: onboardingReferralSchema.nullable(),
	ruleIds: z.array(z.string().min(1).max(64)).max(32),
	reported: z.array(z.number().int().positive()).max(ONBOARDING_MAX_REPORTED),
	workflowId: z.string().min(1).max(64).nullable(),
});
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

export const EMPTY_ONBOARDING_ANSWERS: OnboardingAnswers = {
	intents: [],
	usage: null,
	role: null,
	teamSize: null,
	referral: null,
	ruleIds: [],
	reported: [],
	workflowId: null,
};

/** Partial answers a step saves; merged over the stored answers server-side. */
export const onboardingAnswersPatchSchema = onboardingAnswersSchema.partial();
export type OnboardingAnswersPatch = z.infer<
	typeof onboardingAnswersPatchSchema
>;

export const onboardingRepoSchema = z.object({
	id: z.string(),
	forge: forgeIdSchema,
	fullName: z.string(),
	name: z.string(),
	armed: z.boolean(),
});
export type OnboardingRepo = z.infer<typeof onboardingRepoSchema>;

export const onboardingViewSchema = z.object({
	status: onboardingStatusSchema,
	step: onboardingStepSchema,
	answers: onboardingAnswersSchema,
	orgSlug: z.string().nullable(),
	repo: onboardingRepoSchema.nullable(),
});
export type OnboardingView = z.infer<typeof onboardingViewSchema>;

/**
 * A rule pick on the `rules` step: a rule pack, or AI review on its own.
 * `intents` are the `problems` answers that recommend it.
 */
export interface OnboardingRulePick {
	id: string;
	ruleIds: readonly string[];
	intents: readonly OnboardingIntent[];
}

function packRules(packId: string): readonly string[] {
	return RULE_PACKS.find((pack) => pack.id === packId)?.ruleIds ?? [];
}

export const ONBOARDING_RULE_PICKS: readonly OnboardingRulePick[] = [
	{
		id: "spam-protection",
		ruleIds: packRules("spam-protection"),
		intents: ["new-accounts", "floods", "off-language", "not-sure"],
	},
	{
		id: "crypto-scams",
		ruleIds: packRules("crypto-scams"),
		intents: ["crypto-spam", "workflow-tampering", "not-sure"],
	},
	{
		id: "ai-review",
		ruleIds: ["ai-review"],
		intents: ["drive-by-slop"],
	},
	{
		id: "first-time-contributors",
		ruleIds: packRules("first-time-contributors"),
		intents: [],
	},
	{
		id: "bulk-changes",
		ruleIds: packRules("bulk-changes"),
		intents: ["mass-changes"],
	},
];

/** Picks recommended for the given intents, in pick order. */
export function recommendedRulePicks(
	intents: readonly OnboardingIntent[],
): OnboardingRulePick[] {
	const chosen = intents.length === 0 ? ["not-sure" as const] : intents;
	return ONBOARDING_RULE_PICKS.filter((pick) =>
		pick.intents.some((intent) => chosen.includes(intent)),
	);
}

/**
 * The steps a user sees, given their answers and what the repo can offer.
 * `workspace` only applies to teams. `check` needs a change request Tripwire
 * already stored, and `workflow` is built from the ones the user reported, so
 * it drops out once `check` ends with nothing reported.
 */
export function visibleOnboardingSteps(input: {
	usage: OnboardingUsage | null;
	hasChangeRequests: boolean;
	reportedCount: number;
	checkDone: boolean;
}): OnboardingStep[] {
	return ONBOARDING_STEPS.filter((step) => {
		if (step === "workspace") {
			return input.usage !== "personal";
		}
		if (step === "check") {
			return input.hasChangeRequests;
		}
		if (step === "workflow") {
			return (
				input.hasChangeRequests &&
				!(input.checkDone && input.reportedCount === 0)
			);
		}
		return true;
	});
}

/** Rules that close outright in a drafted workflow; the rest go to human review. */
const CLOSE_ON_FAIL: readonly string[] = ["account-age"];

/**
 * The workflow drafted from the change requests a user reported: every rule
 * that failed on them gets its own branch off one change-request trigger.
 * Deterministic, so the same reports always draft the same workflow.
 */
export function draftOnboardingWorkflow(input: {
	id: string;
	name: string;
	failed: readonly { ruleId: string; config: JsonValue }[];
}): WorkflowDefinition | null {
	const seen = new Set<string>();
	const nodes: WorkflowNode[] = [
		{
			id: "trigger",
			type: "trigger",
			kinds: ["change-request.opened", "change-request.updated"],
		},
	];
	const edges: WorkflowEdge[] = [];
	for (const rule of input.failed) {
		const entry = RULE_CATALOG.find((item) => item.ruleId === rule.ruleId);
		if (!entry || seen.has(rule.ruleId)) {
			continue;
		}
		seen.add(rule.ruleId);
		const actionId = `${rule.ruleId}-action`;
		nodes.push(
			{
				id: rule.ruleId,
				type: "rule",
				ref: `${rule.ruleId}@${entry.version}`,
				config: rule.config,
			},
			{
				id: actionId,
				type: "action",
				action: CLOSE_ON_FAIL.includes(rule.ruleId)
					? "close"
					: "send-to-moderation",
			},
		);
		edges.push(
			{ id: `trigger-${rule.ruleId}`, from: "trigger", to: rule.ruleId },
			{
				id: `${rule.ruleId}-fail`,
				from: rule.ruleId,
				to: actionId,
				when: "fail",
			},
		);
	}
	if (seen.size === 0) {
		return null;
	}
	return { id: input.id, name: input.name, version: 1, nodes, edges };
}
