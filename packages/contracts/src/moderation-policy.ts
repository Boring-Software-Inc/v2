import { z } from "zod";
import { DEFAULT_WORKFLOW } from "./workflow.ts";

export const STANDALONE_MODERATION_NODE_ID = `${DEFAULT_WORKFLOW.id}:moderation-outcome`;

export const standaloneModerationWaiverSchema = z.object({
	waived: z.literal(true),
	appealId: z.uuid(),
});

export const moderationSubjectSchema = z.enum(["issue", "change-request"]);
export type ModerationSubject = z.infer<typeof moderationSubjectSchema>;

export const moderationOutcomeSchema = z.enum([
	"warn",
	"human-review",
	"block",
	"close",
]);
export type ModerationOutcome = z.infer<typeof moderationOutcomeSchema>;

export const MODERATION_OUTCOME_LABELS = {
	warn: "Warn",
	"human-review": "Human review",
	block: "Block",
	close: "Close",
} satisfies Record<ModerationOutcome, string>;

export const standaloneModerationDecisionSchema = z.object({
	outcome: moderationOutcomeSchema,
	ruleRef: z.string().min(1),
	failed: z.array(
		z.object({
			nodeId: z.string().min(1),
			ref: z.string().min(1),
			outcome: moderationOutcomeSchema,
		}),
	),
});

export const moderationOutcomeOverrideSchema = z.union([
	moderationOutcomeSchema,
	z.literal("inherit"),
]);
export type ModerationOutcomeOverride = z.infer<
	typeof moderationOutcomeOverrideSchema
>;

export const moderationRuleIdSchema = z
	.string()
	.max(160)
	.regex(/^(?:[a-z][a-z0-9-]*|custom-[a-z0-9][a-z0-9-]*@1)$/);
export type ModerationRuleId = z.infer<typeof moderationRuleIdSchema>;

export const moderationDefaultsSchema = z.strictObject({
	issue: moderationOutcomeSchema.default("warn"),
	"change-request": moderationOutcomeSchema.default("block"),
});
export type ModerationDefaults = z.infer<typeof moderationDefaultsSchema>;

const repoModerationDefaultsSchema = z.partialRecord(
	moderationSubjectSchema,
	moderationOutcomeSchema,
);
const ruleModerationOutcomesSchema = z.partialRecord(
	moderationSubjectSchema,
	moderationOutcomeOverrideSchema,
);

export const orgModerationPolicySchema = z.strictObject({
	defaults: moderationDefaultsSchema.prefault({}),
});
export type OrgModerationPolicy = z.infer<typeof orgModerationPolicySchema>;

export const repoModerationPolicySchema = z.strictObject({
	defaults: repoModerationDefaultsSchema.default({}),
	issueRulesEnabled: z.boolean().default(false),
	ruleOutcomes: z
		.record(moderationRuleIdSchema, ruleModerationOutcomesSchema)
		.default({}),
});
export type RepoModerationPolicy = z.infer<typeof repoModerationPolicySchema>;

export const effectiveRepoModerationPolicySchema =
	repoModerationPolicySchema.extend({ defaults: moderationDefaultsSchema });
export type EffectiveRepoModerationPolicy = z.infer<
	typeof effectiveRepoModerationPolicySchema
>;

export const repoModerationPolicyPatchSchema = z.strictObject({
	defaults: z
		.partialRecord(moderationSubjectSchema, moderationOutcomeSchema.nullable())
		.optional(),
	issueRulesEnabled: z.boolean().optional(),
	ruleOutcome: z
		.strictObject({
			ruleId: moderationRuleIdSchema,
			subject: moderationSubjectSchema,
			outcome: moderationOutcomeOverrideSchema.nullable(),
		})
		.optional(),
});
export type RepoModerationPolicyPatch = z.infer<
	typeof repoModerationPolicyPatchSchema
>;

export const allowlistAccountIdSchema = z
	.string()
	.max(20)
	.regex(/^[1-9][0-9]*$/);
export type AllowlistAccountId = z.infer<typeof allowlistAccountIdSchema>;

export const allowlistLoginSchema = z
	.string()
	.max(44)
	.regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/);

export const allowlistGitHubAccountSchema = z.object({
	id: z.number().int().positive().safe(),
	login: allowlistLoginSchema,
});

export const allowlistEntryInputSchema = z.strictObject({
	accountId: allowlistAccountIdSchema,
	login: allowlistLoginSchema,
});
export type AllowlistEntryInput = z.infer<typeof allowlistEntryInputSchema>;

export const allowlistEntrySchema = allowlistEntryInputSchema.extend({
	createdAt: z.iso.datetime(),
});
export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>;

export const DEFAULT_ORG_MODERATION_POLICY = orgModerationPolicySchema.parse(
	{},
);
export const DEFAULT_REPO_MODERATION_POLICY = repoModerationPolicySchema.parse(
	{},
);
