import { z } from "zod";
import { rulePreviewSchema } from "./rule-packs.ts";
import { verdictSchema } from "./runs.ts";

export const homeDigestInputSchema = z.object({
	org: z.string().min(1),
});
export type HomeDigestInput = z.infer<typeof homeDigestInputSchema>;

export const digestHistoryWindowSchema = z
	.object({
		from: z.iso.datetime(),
		to: z.iso.datetime(),
	})
	.refine(({ from, to }) => from <= to, "The period must end after it starts");
export type DigestHistoryWindow = z.infer<typeof digestHistoryWindowSchema>;

export const digestHistoryInputSchema = digestHistoryWindowSchema.safeExtend({
	org: z.string().min(1),
	repo: z.string().min(1),
	verdict: z.union([verdictSchema, z.literal("all")]).default("all"),
});
export type DigestHistoryInput = z.infer<typeof digestHistoryInputSchema>;

export const digestHistorySchema = z.object({
	total: z.number().int().nonnegative(),
	runs: z.array(
		z.object({
			id: z.string(),
			number: z.number().int().nullable(),
			verdict: verdictSchema,
			status: z.string(),
			createdAt: z.iso.datetime(),
		}),
	),
});
export type DigestHistory = z.infer<typeof digestHistorySchema>;

export const digestRepoSchema = z.object({
	id: z.string(),
	name: z.string(),
	fullName: z.string(),
	armed: z.boolean(),
	counts: z.array(
		z.object({ verdict: verdictSchema, count: z.number().int().nonnegative() }),
	),
	latestRuns: z.array(
		z.object({
			number: z.number().int(),
			eventId: z.string(),
			verdict: verdictSchema.nullable(),
			createdAt: z.string().datetime(),
		}),
	),
	preview: rulePreviewSchema.nullable(),
	uninstalledRuleIds: z.array(z.string()),
});
export type DigestRepo = z.infer<typeof digestRepoSchema>;

export const homeDigestSchema = z.object({
	from: z.string().datetime(),
	to: z.string().datetime(),
	total: z.number().int().nonnegative(),
	repos: z.array(z.object({ id: z.string(), name: z.string() })),
	counts: z.array(
		z.object({ verdict: verdictSchema, count: z.number().int().nonnegative() }),
	),
	caught: z
		.object({
			repoId: z.string(),
			repoName: z.string(),
			armed: z.boolean(),
			number: z.number().int(),
			title: z.string(),
			ruleId: z.string(),
			ruleName: z.string(),
			url: z.string().url(),
		})
		.nullable(),
});
export type HomeDigest = z.infer<typeof homeDigestSchema>;
