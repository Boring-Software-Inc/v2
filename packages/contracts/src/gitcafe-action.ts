import { z } from "zod";
import { verdictSchema } from "./runs.ts";

const ID = z.string().min(1).max(255);
const VERSION = z.number().int().min(0).max(2147483646);
const OID = z.string().regex(/^[0-9a-f]{40}$/);

export const gitCafeActionCommentSchema = z.object({
	id: ID,
	authorActorId: ID,
	body: z.string().nullable(),
	version: VERSION,
	deletedAt: z.iso.datetime().nullable().optional(),
	capabilities: z.object({ edit: z.boolean(), delete: z.boolean() }),
});
export type GitCafeActionComment = z.infer<typeof gitCafeActionCommentSchema>;

export const gitCafeActionCommentPageSchema = z.object({
	items: z.array(gitCafeActionCommentSchema),
	next: z
		.string()
		.regex(/^[A-Za-z0-9_-]{1,8192}$/)
		.nullable(),
});
export type GitCafeActionCommentPage = z.infer<
	typeof gitCafeActionCommentPageSchema
>;

export const gitCafeActionReviewSchema = z.object({
	id: ID,
	authorActorId: ID,
	authorViaInstallationId: ID.nullable(),
	body: z.string().nullable(),
	commitOid: OID,
	verdict: z.enum(["approve", "request_changes", "comment"]),
	version: VERSION,
	dismissedAt: z.iso.datetime().nullable(),
});
export type GitCafeActionReview = z.infer<typeof gitCafeActionReviewSchema>;

export const gitCafeActionCreatedReviewSchema = z.object({
	id: ID,
	commitOid: OID,
	verdict: z.enum(["approve", "request_changes", "comment"]),
	author: z.object({ actorId: ID }),
});
export type GitCafeActionCreatedReview = z.infer<
	typeof gitCafeActionCreatedReviewSchema
>;

export const gitCafeActionReviewPageSchema = z.object({
	items: z.array(gitCafeActionReviewSchema),
	next: gitCafeActionCommentPageSchema.shape.next,
});
export type GitCafeActionReviewPage = z.infer<
	typeof gitCafeActionReviewPageSchema
>;

export const gitCafeActionReviewCreateSchema = z.strictObject({
	verdict: z.literal("request_changes"),
	body: z.string().max(261120),
	commitOid: OID,
	expectedVersion: VERSION,
	requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});
export type GitCafeActionReviewCreate = z.infer<
	typeof gitCafeActionReviewCreateSchema
>;

export const gitCafeActionCreateCommandSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("comment"),
		body: z.string().min(1).max(261120),
	}),
	z.strictObject({
		kind: z.literal("review"),
		input: gitCafeActionReviewCreateSchema,
	}),
]);
export type GitCafeActionCreateCommand = z.infer<
	typeof gitCafeActionCreateCommandSchema
>;

/** Persisted before dispatch so ambiguous comment delivery is reconciled rather than blindly repeated. */
export const gitCafeActionOperationSchema = z.strictObject({
	format: z.literal("gitcafe-action@1"),
	actionId: z.uuid(),
	installationId: ID,
	repositoryId: ID,
	repoFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
	subject: z.enum(["change-request", "issue"]),
	number: z.number().int().positive().max(2147483647),
	headOid: OID.nullable(),
	recordedAt: z.iso.datetime(),
	command: gitCafeActionCreateCommandSchema,
	dispatched: z.boolean(),
	reviewReceipt: ID.nullable().default(null),
});
export type GitCafeActionOperation = z.infer<
	typeof gitCafeActionOperationSchema
>;

export const gitCafeEvaluationPhaseSchema = z.strictObject({
	verdict: verdictSchema,
	headSha: OID.nullable(),
	appliedItems: z.array(z.uuid()),
});
export type GitCafeEvaluationPhase = z.infer<
	typeof gitCafeEvaluationPhaseSchema
>;

export const GITCAFE_VERDICT_ACTION_KINDS: ReadonlySet<string> = new Set([
	"block",
	"close",
	"comment",
	"delete-comment",
	"set-check",
	"dismiss-review",
]);

export const gitCafeActionPayloadSchema = z.looseObject({
	gitCafeOperation: gitCafeActionOperationSchema.optional(),
	gitCafePhase: gitCafeEvaluationPhaseSchema.optional(),
	reason: z.string().optional(),
	verdict: verdictSchema.optional(),
});
export type GitCafeActionPayload = z.infer<typeof gitCafeActionPayloadSchema>;

export const gitCafeActionBindingSchema = gitCafeActionOperationSchema.omit({
	format: true,
	command: true,
	dispatched: true,
	reviewReceipt: true,
});
export type GitCafeActionBinding = z.infer<typeof gitCafeActionBindingSchema>;

export const gitCafeActionSubjectSchema = z.object({
	id: ID,
	repoId: ID,
	version: VERSION,
	headOid: OID.nullable().optional(),
	state: z.string().optional(),
	stateType: z.string().optional(),
	lockedAt: z.iso.datetime().nullable(),
});
export type GitCafeActionSubject = z.infer<typeof gitCafeActionSubjectSchema>;

export const gitCafeActionLabelSchema = z.object({ id: ID, name: z.string() });
export type GitCafeActionLabel = z.infer<typeof gitCafeActionLabelSchema>;
export const gitCafeActionLabelPageSchema = z.object({
	items: z.array(gitCafeActionLabelSchema),
	next: gitCafeActionCommentPageSchema.shape.next,
});
export type GitCafeActionLabelPage = z.infer<
	typeof gitCafeActionLabelPageSchema
>;

export const gitCafeActionReviewerSchema = z.object({
	id: ID,
	handle: z.string().nullable(),
});
export type GitCafeActionReviewer = z.infer<typeof gitCafeActionReviewerSchema>;
export const gitCafeActionReviewerPageSchema = z.object({
	items: z.array(gitCafeActionReviewerSchema),
	next: gitCafeActionCommentPageSchema.shape.next,
});
export type GitCafeActionReviewerPage = z.infer<
	typeof gitCafeActionReviewerPageSchema
>;

export const gitCafeActionVersionInputSchema = z.strictObject({
	expectedVersion: VERSION,
});
export type GitCafeActionVersionInput = z.infer<
	typeof gitCafeActionVersionInputSchema
>;
export const gitCafeActionCommentWriteSchema = z.strictObject({
	body: z.string().min(1).max(261120),
	expectedVersion: VERSION.optional(),
});
export type GitCafeActionCommentWrite = z.infer<
	typeof gitCafeActionCommentWriteSchema
>;
export const gitCafeActionDismissInputSchema = z.strictObject({
	expectedVersion: VERSION,
	expectedPullVersion: VERSION,
	reason: z.string().min(1).max(65536),
});
export type GitCafeActionDismissInput = z.infer<
	typeof gitCafeActionDismissInputSchema
>;

export const gitCafeActionLabelInputSchema = z.strictObject({
	expectedVersion: VERSION,
	labelIds: z.array(ID).max(100),
});
export type GitCafeActionLabelInput = z.infer<
	typeof gitCafeActionLabelInputSchema
>;
export const gitCafeActionLabelResultSchema = z.object({
	version: VERSION,
	items: z.array(gitCafeActionLabelSchema),
});
export type GitCafeActionLabelResult = z.infer<
	typeof gitCafeActionLabelResultSchema
>;

export const gitCafeActionReviewerInputSchema = z.strictObject({
	expectedVersion: VERSION,
	actorIds: z.array(ID).max(20),
});
export type GitCafeActionReviewerInput = z.infer<
	typeof gitCafeActionReviewerInputSchema
>;
export const gitCafeActionReviewerResultSchema = z.object({
	version: VERSION,
	items: z.array(gitCafeActionReviewerSchema),
});
export type GitCafeActionReviewerResult = z.infer<
	typeof gitCafeActionReviewerResultSchema
>;

export const gitCafeActionLockInputSchema = z.strictObject({
	expectedVersion: VERSION,
	reason: z.enum(["off_topic", "too_heated", "resolved", "spam"]),
});
export type GitCafeActionLockInput = z.infer<
	typeof gitCafeActionLockInputSchema
>;
