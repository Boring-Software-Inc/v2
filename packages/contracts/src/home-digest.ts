import { z } from "zod";
import { rulePreviewSchema } from "./rule-packs.ts";
import { verdictSchema } from "./runs.ts";

export const homeDigestInputSchema = z.object({
	org: z.string().min(1),
});
export type HomeDigestInput = z.infer<typeof homeDigestInputSchema>;

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
