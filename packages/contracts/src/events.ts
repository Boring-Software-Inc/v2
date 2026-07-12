import { z } from "zod";
import { type RepoRef, repoRefSchema } from "./repo.ts";

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
	"installation.created",
	"installation.deleted",
	"installation-repositories.added",
	"installation-repositories.removed",
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
	/** True when this is Tripwire's own comment (carries the run marker, §7). */
	byTripwire: z.boolean().optional(),
});
export type CommentPayload = z.infer<typeof commentPayloadSchema>;

export const pushPayloadSchema = z.object({
	ref: z.string(),
	headSha: z.string(),
	commitCount: z.number().int(),
	/** The forge's compare view for the pushed range (§9 deep link). */
	url: z.string().optional(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

const eventBase = {
	/** UUIDv7, assigned at ingest. */
	id: z.string(),
	forge: z.literal("github"),
	/** The forge's delivery id (X-GitHub-Delivery) — the idempotency key. */
	deliveryId: z.string(),
	repo: repoRefSchema,
	/** The forge's repo id, as a string — installation sync + lazy repo upsert. */
	repoExternalId: z.string().optional(),
	actor: eventActorSchema,
	occurredAt: z.iso.datetime(),
	receivedAt: z.iso.datetime(),
};

/** Installation events span repos, so they carry a list, not a base repo. */
const installationBase = {
	id: z.string(),
	forge: z.literal("github"),
	deliveryId: z.string(),
	actor: eventActorSchema,
	occurredAt: z.iso.datetime(),
	receivedAt: z.iso.datetime(),
	installation: z.object({
		/** The App installation id, as a string. */
		externalId: z.string(),
		/** The org/user account the App is installed on. */
		account: z.string(),
	}),
	repositories: z.array(
		z.object({
			externalId: z.string(),
			owner: z.string(),
			name: z.string(),
			fullName: z.string(),
			private: z.boolean(),
		}),
	),
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
	z.object({ ...installationBase, kind: z.literal("installation.created") }),
	z.object({ ...installationBase, kind: z.literal("installation.deleted") }),
	z.object({
		...installationBase,
		kind: z.literal("installation-repositories.added"),
	}),
	z.object({
		...installationBase,
		kind: z.literal("installation-repositories.removed"),
	}),
]);
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;

/** Events scoped to a single repo — everything except installation sync. */
export type RepoScopedEvent = Extract<NormalizedEvent, { repo: RepoRef }>;

/** Installation-sync events (no single base repo). */
export type InstallationEvent = Extract<
	NormalizedEvent,
	{ installation: { externalId: string } }
>;
