import { z } from "zod";
import { gitCafeInstallationSchema } from "./gitcafe-installation.ts";

export const GITCAFE_LIFECYCLE_QUEUE = "gitcafe-lifecycle";
export const GITCAFE_RECEIPT_APP_ID = "int_01m60999c0fqg841d48s29qwtv";
export const GITCAFE_RECEIPT_MAX_BYTES = 1024 * 1024;

export const gitCafeReceiptConfigSchema = z.strictObject({
	appId: z.literal(GITCAFE_RECEIPT_APP_ID),
	keyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
	secret: z.string().min(1),
});
export type GitCafeReceiptConfig = z.infer<typeof gitCafeReceiptConfigSchema>;

export const gitCafeEventEnvelopeSchema = z.looseObject({
	id: z.string().startsWith("evt_").min(5).max(128),
	version: z.literal("1"),
	type: z.string().min(1).max(128),
	createdAt: z.iso.datetime(),
	installation: z.looseObject({
		id: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/),
	}),
});
export type GitCafeEventEnvelope = z.infer<typeof gitCafeEventEnvelopeSchema>;

export const gitCafeLifecycleEventTypeSchema = z.enum([
	"installation.created",
	"installation.repositories_updated",
	"installation.paused",
	"installation.uninstalled",
]);
export type GitCafeLifecycleEventType = z.infer<
	typeof gitCafeLifecycleEventTypeSchema
>;

export const gitCafeLifecycleEventSchema = gitCafeEventEnvelopeSchema.extend({
	type: gitCafeLifecycleEventTypeSchema,
	actor: z.object({ id: z.string().min(1) }).optional(),
	organization: z.object({ id: z.string().min(1) }),
});
export type GitCafeLifecycleEvent = z.infer<typeof gitCafeLifecycleEventSchema>;

export const gitCafeInstallationCreatedSchema =
	gitCafeLifecycleEventSchema.extend({
		type: z.literal("installation.created"),
		repositorySelection: z.enum(["all", "selected"]),
		repositories: z.array(
			z.object({
				id: z.string().min(1),
				owner: z.string().min(1),
				name: z.string().min(1),
			}),
		),
		repositoriesTruncated: z.boolean(),
	});
export type GitCafeInstallationCreated = z.infer<
	typeof gitCafeInstallationCreatedSchema
>;

export const gitCafeRepositoriesUpdatedSchema =
	gitCafeLifecycleEventSchema.extend({
		type: z.literal("installation.repositories_updated"),
		repositorySelection: z.enum(["all", "selected"]),
		previousRepositorySelection: z.enum(["all", "selected"]),
		repositoriesAdded: gitCafeInstallationCreatedSchema.shape.repositories,
		repositoriesRemoved: z.array(z.object({ id: z.string().min(1) })),
		repositoriesRemovedTruncated: z.boolean(),
	});
export type GitCafeRepositoriesUpdated = z.infer<
	typeof gitCafeRepositoriesUpdatedSchema
>;

/** Exact signed bytes stay separate from normalization and credentials. */
export const gitCafeReceiptSchema = z.strictObject({
	format: z.literal("gitcafe-receipt@1"),
	appId: z.literal(GITCAFE_RECEIPT_APP_ID),
	payload: gitCafeEventEnvelopeSchema,
	bodyBase64: z.base64().max(Math.ceil(GITCAFE_RECEIPT_MAX_BYTES / 3) * 4),
	bodySha256: z.string().regex(/^[0-9a-f]{64}$/),
	deliveryId: z.string().min(1).max(255),
	keyVersion: gitCafeReceiptConfigSchema.shape.keyVersion,
	signedAt: z.string().regex(/^(0|[1-9][0-9]*)$/),
	requestId: z.uuid(),
});
export type GitCafeReceipt = z.infer<typeof gitCafeReceiptSchema>;

export const gitCafeReceiptJobSchema = z.strictObject({
	receiptId: z.uuid(),
	requestId: z.uuid(),
});
export type GitCafeReceiptJob = z.infer<typeof gitCafeReceiptJobSchema>;

export const gitCafeReceiptStatusSchema = z.enum([
	"pending",
	"applied",
	"stale",
	"parked",
	"malformed",
]);
export type GitCafeReceiptStatus = z.infer<typeof gitCafeReceiptStatusSchema>;

export const gitCafeLifecycleStatusSchema = z.enum([
	"active",
	"reconcile-required",
	"paused",
	"uninstalled",
]);
export type GitCafeLifecycleStatus = z.infer<
	typeof gitCafeLifecycleStatusSchema
>;

export const gitCafeRetirementSchema = z.strictObject({
	installationId: gitCafeEventEnvelopeSchema.shape.installation.shape.id,
	reason: z.enum(["reconcile-required", "paused", "uninstalled"]),
});
export type GitCafeRetirement = z.infer<typeof gitCafeRetirementSchema>;

export const gitCafeLifecycleLookupSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true), value: gitCafeInstallationSchema }),
	z.object({
		ok: z.literal(false),
		reason: z.string().min(1),
		status: z.number().int().optional(),
	}),
]);
export type GitCafeLifecycleLookup = z.infer<
	typeof gitCafeLifecycleLookupSchema
>;
