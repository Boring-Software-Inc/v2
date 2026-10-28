import { z } from "zod";
import { eventActorSchema } from "./events.ts";
import { gitCafeEventEnvelopeSchema } from "./gitcafe-receipt.ts";

const OID = z.string().regex(/^[0-9a-f]{40}$/);

export const gitCafeRepositoryEventSchema = gitCafeEventEnvelopeSchema.extend({
	actor: z.object({ id: z.string().min(1) }).optional(),
	repository: z.object({
		id: z.string().min(1),
		orgId: z.string().min(1),
		owner: z.string().regex(/^[A-Za-z0-9_.-]+$/),
		name: z.string().regex(/^[A-Za-z0-9_.-]+$/),
	}),
});
export type GitCafeRepositoryEvent = z.infer<
	typeof gitCafeRepositoryEventSchema
>;

export const gitCafePullEventSchema = gitCafeRepositoryEventSchema.extend({
	type: z.enum([
		"pull.created",
		"pull.updated",
		"pull.synchronized",
		"pull.reopened",
		"pull.closed",
		"pull.merged",
		"pull.drafted",
		"pull.ready",
	]),
	pull: z.object({
		id: z.string().min(1),
		number: z.number().int().positive().max(2147483647),
		version: z.number().int().nonnegative().safe(),
		title: z.string(),
		state: z.enum(["open", "closed", "merged"]),
		draft: z.boolean(),
		headOid: OID.nullable(),
		authorActorId: z.string().min(1).nullable(),
		sourceBranch: z.string().min(1),
		targetBranch: z.string().min(1),
	}),
});
export type GitCafePullEvent = z.infer<typeof gitCafePullEventSchema>;

export const gitCafePullIdentitySchema =
	gitCafePullEventSchema.shape.pull.extend({
		repoId: z.string().min(1),
		author: z.object({
			kind: z.string().min(1),
			actorId: z.string().min(1).nullable(),
			handle: z.string().min(1).nullable(),
			avatarUrl: z.string().nullable(),
		}),
	});
export type GitCafePullIdentity = z.infer<typeof gitCafePullIdentitySchema>;

/** Hydrated identity is separate from the immutable signed receipt. */
export const gitCafeHydratedPullEventSchema = z
	.strictObject({
		event: gitCafePullEventSchema,
		author: eventActorSchema.extend({ login: z.string().min(1) }),
		sender: eventActorSchema.optional(),
	})
	.refine((value) => value.author.externalId === value.event.pull.authorActorId)
	.refine(
		(value) =>
			value.sender === undefined ||
			value.sender.externalId === value.event.actor?.id,
	);
export type GitCafeHydratedPullEvent = z.infer<
	typeof gitCafeHydratedPullEventSchema
>;

export const gitCafeCheckRerequestedEventSchema =
	gitCafeRepositoryEventSchema.extend({
		type: z.literal("check.rerequested"),
		bot: z.object({ id: z.string().min(1) }),
		checkRun: z.object({
			id: z.string().min(1),
			key: z.string().min(1).max(100),
			name: z.string().min(1),
			headOid: OID,
			externalId: z.string().nullable(),
			detailsUrl: z.string().nullable(),
		}),
	});
export type GitCafeCheckRerequestedEvent = z.infer<
	typeof gitCafeCheckRerequestedEventSchema
>;

export const gitCafePushEventSchema = gitCafeRepositoryEventSchema.extend({
	type: z.literal("git.push"),
	git: z.object({
		source: z.enum([
			"push",
			"merge",
			"merge_cleanup",
			"restack",
			"mirror",
			"github_sync",
		]),
		refUpdatesCount: z.number().int().nonnegative().safe(),
		refUpdatesTruncated: z.boolean(),
		refUpdates: z
			.array(
				z.object({
					ref: z.string().min(1),
					beforeOid: OID.nullable(),
					afterOid: OID.nullable(),
					created: z.boolean(),
					deleted: z.boolean(),
					forced: z.boolean(),
				}),
			)
			.max(100),
	}),
});
export type GitCafePushEvent = z.infer<typeof gitCafePushEventSchema>;
