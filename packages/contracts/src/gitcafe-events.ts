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

export const gitCafePullCommentEventSchema =
	gitCafeRepositoryEventSchema.extend({
		type: z.literal("pull.comment_created"),
		pull: gitCafePullEventSchema.shape.pull,
		commentId: z.string().min(1).max(255),
		comment: z.object({
			id: z.string().min(1).max(255),
			authorActorId: z.string().min(1).nullable(),
			body: z.string().max(261120).nullable(),
			version: z.number().int().nonnegative().safe(),
			hidden: z.boolean(),
			deleted: z.boolean(),
			bodyTruncated: z.boolean(),
		}),
	});
export type GitCafePullCommentEvent = z.infer<
	typeof gitCafePullCommentEventSchema
>;

export const gitCafeIssueCommentEventSchema =
	gitCafeRepositoryEventSchema.extend({
		type: z.literal("issue.comment_created"),
		issue: z.object({
			id: z.string().min(1).max(255),
			number: z.number().int().positive().max(2147483647),
			version: z.number().int().nonnegative().safe(),
		}),
		commentId: gitCafePullCommentEventSchema.shape.commentId,
		comment: gitCafePullCommentEventSchema.shape.comment.pick({
			id: true,
			authorActorId: true,
			body: true,
			version: true,
		}),
	});
export type GitCafeIssueCommentEvent = z.infer<
	typeof gitCafeIssueCommentEventSchema
>;

export const gitCafeCommentEventSchema = z
	.discriminatedUnion("type", [
		gitCafePullCommentEventSchema,
		gitCafeIssueCommentEventSchema,
	])
	.refine((event) => event.commentId === event.comment.id);
export type GitCafeCommentEvent = z.infer<typeof gitCafeCommentEventSchema>;

export const gitCafeCommentIdentitySchema = z.object({
	id: gitCafePullCommentEventSchema.shape.commentId,
	authorActorId: z.string().min(1).nullable(),
	author: gitCafePullIdentitySchema.shape.author,
	body: gitCafePullCommentEventSchema.shape.comment.shape.body,
	version: gitCafePullCommentEventSchema.shape.comment.shape.version,
});
export type GitCafeCommentIdentity = z.infer<
	typeof gitCafeCommentIdentitySchema
>;

export const gitCafeCommentDetailSchema = gitCafeCommentIdentitySchema.extend({
	hiddenAt: z.iso.datetime().nullable(),
	deletedAt: z.iso.datetime().nullable(),
});
export type GitCafeCommentDetail = z.infer<typeof gitCafeCommentDetailSchema>;

export const gitCafeCommentSubjectSchema =
	gitCafeIssueCommentEventSchema.shape.issue
		.omit({ version: true })
		.extend({ repoId: z.string().min(1).max(255) });
export type GitCafeCommentSubject = z.infer<typeof gitCafeCommentSubjectSchema>;

export const gitCafeIssueCommentPageSchema = z.object({
	items: z.array(
		gitCafeCommentIdentitySchema.extend({
			repoId: z.string().min(1).max(255),
			issueId: z.string().min(1).max(255),
		}),
	),
	next: z
		.string()
		.regex(/^[A-Za-z0-9_-]{1,8192}$/)
		.nullable(),
});
export type GitCafeIssueCommentPage = z.infer<
	typeof gitCafeIssueCommentPageSchema
>;

export const gitCafeHydratedCommentEventSchema = z
	.strictObject({
		event: gitCafeCommentEventSchema,
		author: eventActorSchema.extend({ login: z.string().min(1) }),
		sender: eventActorSchema.optional(),
		botActorId: z.string().min(1),
	})
	.refine(
		(value) => value.author.externalId === value.event.comment.authorActorId,
	)
	.refine(
		(value) =>
			value.sender === undefined ||
			value.sender.externalId === value.event.actor?.id,
	);
export type GitCafeHydratedCommentEvent = z.infer<
	typeof gitCafeHydratedCommentEventSchema
>;

export const gitCafeDispatchableRepositoryEventTypeSchema = z.enum([
	...gitCafePullEventSchema.shape.type.options,
	"pull.comment_created",
	"issue.comment_created",
]);
export type GitCafeDispatchableRepositoryEventType = z.infer<
	typeof gitCafeDispatchableRepositoryEventTypeSchema
>;

export const gitCafeDispatchableRepositoryEventSchema = z.union([
	gitCafePullEventSchema,
	gitCafeCommentEventSchema,
]);
export type GitCafeDispatchableRepositoryEvent = z.infer<
	typeof gitCafeDispatchableRepositoryEventSchema
>;

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

export const gitCafePushRefDeliverySchema = z.tuple([
	gitCafeEventEnvelopeSchema.shape.installation.shape.id,
	gitCafeEventEnvelopeSchema.shape.id,
	z.string().min(1).max(4096),
]);
export type GitCafePushRefDelivery = z.infer<
	typeof gitCafePushRefDeliverySchema
>;

export const gitCafeHydratedPushRefSchema = z.strictObject({
	event: gitCafePushEventSchema,
	ref: z.string().min(1),
	author: eventActorSchema,
	sender: eventActorSchema.optional(),
});
export type GitCafeHydratedPushRef = z.infer<
	typeof gitCafeHydratedPushRefSchema
>;
