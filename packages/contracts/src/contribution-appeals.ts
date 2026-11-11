import { z } from "zod";

export const contributionAppealRunSchema = z.object({
	runId: z.uuid(),
});

export const submitContributionAppealSchema =
	contributionAppealRunSchema.extend({
		reason: z.string().trim().min(1).max(2_000),
	});

export const contributionAppealDecisionSchema = z.enum([
	"approve-once",
	"approve-author",
	"deny",
]);
export type ContributionAppealDecision = z.infer<
	typeof contributionAppealDecisionSchema
>;

export const listContributionAppealsSchema = z.object({
	org: z.string().min(1).max(100),
	repo: z.string().min(1).max(100),
});

export const decideContributionAppealSchema =
	listContributionAppealsSchema.extend({
		appealId: z.uuid(),
		decision: contributionAppealDecisionSchema,
	});

export const contributionAppealStatusSchema = z.union([
	z.literal("pending"),
	contributionAppealDecisionSchema,
]);
export type ContributionAppealStatus = z.infer<
	typeof contributionAppealStatusSchema
>;

export const restoreContributionAppealJobSchema = z.object({
	appealId: z.uuid(),
});

export type RestoreContributionAppealJob = z.infer<
	typeof restoreContributionAppealJobSchema
>;

export const appealRestorationGuardSchema = z.object({
	authorId: z.string().min(1),
	headSha: z.string().min(1).optional(),
	subject: z.enum(["issue", "change-request"]),
	appliedAfter: z.iso.datetime(),
	appliedBefore: z.iso.datetime(),
});
export type AppealRestorationGuard = z.infer<
	typeof appealRestorationGuardSchema
>;

export const appealRestorationThreadSchema = z.object({
	state: z.enum(["open", "closed"]),
	locked: z.boolean(),
	user: z.object({ id: z.number().int() }),
	pull_request: z.object({}).optional(),
});
export const appealRestorationPullSchema = z.object({
	merged: z.boolean(),
	head: z.object({ sha: z.string() }),
});
export const appealRestorationEventsSchema = z.array(
	z.object({
		event: z.string(),
		created_at: z.iso.datetime(),
		performed_via_github_app: z.object({ id: z.number().int() }).nullish(),
		actor: z.object({ login: z.string(), type: z.string() }),
	}),
);

export const appealRestorationAppSchema = z.object({ id: z.number().int() });
