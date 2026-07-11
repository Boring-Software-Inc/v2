import { z } from "zod";
import { repoRefSchema } from "./repo.ts";

/**
 * Events domain (spec §4 `events.ts`) — AUTHORED from §5/§6, no demo shape
 * exists. `NormalizedEvent` is the forge-neutral event the adapter's
 * `normalize` emits and the worker consumes; kinds mirror the §6 trigger
 * vocabulary (change-request opened / comment / push) in agnostic terms.
 */

export const eventKindSchema = z.enum([
	"change-request.opened",
	"change-request.updated",
	"change-request.closed",
	"comment.created",
	"push",
]);
export type EventKind = z.infer<typeof eventKindSchema>;

/** The forge-scoped author of an event. Contributors never authenticate (§10). */
export const eventActorSchema = z.object({
	login: z.string(),
	/** The forge's stable id for the account, as a string. */
	externalId: z.string(),
	avatarUrl: z.string().optional(),
});
export type EventActor = z.infer<typeof eventActorSchema>;

/** Change-request payload — "PR" only in GitHub-specific contexts. */
export const changeRequestPayloadSchema = z.object({
	number: z.number().int(),
	title: z.string(),
	headSha: z.string(),
	baseRef: z.string(),
	headRef: z.string(),
	draft: z.boolean(),
	url: z.string(),
});
export type ChangeRequestPayload = z.infer<typeof changeRequestPayloadSchema>;

export const commentPayloadSchema = z.object({
	/** Forge comment id, as a string. */
	externalId: z.string(),
	body: z.string(),
	url: z.string(),
	/** The change request / issue number the comment belongs to. */
	subjectNumber: z.number().int(),
});
export type CommentPayload = z.infer<typeof commentPayloadSchema>;

export const pushPayloadSchema = z.object({
	ref: z.string(),
	headSha: z.string(),
	commitCount: z.number().int(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

const eventBase = {
	/** UUIDv7, assigned at ingest. */
	id: z.string(),
	forge: z.literal("github"),
	/** The forge's delivery id (X-GitHub-Delivery) — the idempotency key. */
	deliveryId: z.string(),
	repo: repoRefSchema,
	actor: eventActorSchema,
	occurredAt: z.iso.datetime(),
	receivedAt: z.iso.datetime(),
};

export const normalizedEventSchema = z.discriminatedUnion("kind", [
	z.object({
		...eventBase,
		kind: z.literal("change-request.opened"),
		changeRequest: changeRequestPayloadSchema,
	}),
	z.object({
		...eventBase,
		kind: z.literal("change-request.updated"),
		changeRequest: changeRequestPayloadSchema,
	}),
	z.object({
		...eventBase,
		kind: z.literal("change-request.closed"),
		changeRequest: changeRequestPayloadSchema,
	}),
	z.object({
		...eventBase,
		kind: z.literal("comment.created"),
		comment: commentPayloadSchema,
	}),
	z.object({
		...eventBase,
		kind: z.literal("push"),
		push: pushPayloadSchema,
	}),
]);
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
