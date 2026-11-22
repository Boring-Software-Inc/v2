import { z } from "zod";
import {
	gitCafeInstallationSchema,
	gitCafePermissionSchema,
} from "./gitcafe-installation.ts";

export const GITCAFE_LIFECYCLE_QUEUE = "gitcafe-lifecycle";
export const GITCAFE_PROCESS_EVENT_QUEUE = "gitcafe-process-event";
export const GITCAFE_RESUME_RUN_QUEUE = "gitcafe-resume-run";
export const GITCAFE_RERUN_QUEUE = "gitcafe-rerun-change-request";
export const GITCAFE_REFRESH_SURFACES_QUEUE = "gitcafe-refresh-surfaces";
export const GITCAFE_REFRESH_CATALOGS_QUEUE = "gitcafe-refresh-catalogs";
export const GITCAFE_SCHEDULE_TICK_QUEUE = "gitcafe-schedule-tick";
export const GITCAFE_BACKFILL_REPO_QUEUE = "gitcafe-backfill-repo";
export const GITCAFE_PROCESS_EVENT_EXPIRE_SECONDS = 90;
export const GITCAFE_STALL_REPORT_INTERVAL_SECONDS = 900;
export const gitCafeScheduleTickJobSchema = z.strictObject({
	requestId: z.uuid(),
});
export type GitCafeScheduleTickJob = z.infer<
	typeof gitCafeScheduleTickJobSchema
>;
export const gitCafeRefreshCatalogsJobSchema = z.strictObject({
	repoId: z.uuid(),
	requestId: z.uuid(),
});
export type GitCafeRefreshCatalogsJob = z.infer<
	typeof gitCafeRefreshCatalogsJobSchema
>;
export const gitCafeProcessEventJobSchema = z.strictObject({
	eventId: z.uuid(),
	requestId: z.uuid(),
});
export type GitCafeProcessEventJob = z.infer<
	typeof gitCafeProcessEventJobSchema
>;
export const gitCafeResumeRunJobSchema = z.strictObject({
	itemId: z.uuid(),
	decision: z.enum(["approve", "deny"]),
});
export type GitCafeResumeRunJob = z.infer<typeof gitCafeResumeRunJobSchema>;
export const gitCafeRefreshSurfacesJobSchema = z.strictObject({
	repoId: z.uuid(),
});
export type GitCafeRefreshSurfacesJob = z.infer<
	typeof gitCafeRefreshSurfacesJobSchema
>;
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
	"installation.permissions_accepted",
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

export const gitCafePermissionsAcceptedSchema =
	gitCafeLifecycleEventSchema.extend({
		type: z.literal("installation.permissions_accepted"),
		revision: z.number().int().positive(),
		permissions: z.array(gitCafePermissionSchema),
		user: z
			.object({
				permissions: z.array(gitCafePermissionSchema),
				audiences: z.array(z.string().min(1)),
			})
			.optional(),
	});
export type GitCafePermissionsAccepted = z.infer<
	typeof gitCafePermissionsAcceptedSchema
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
	"dispatched",
	"applied",
	"stale",
	"parked",
	"malformed",
]);
export type GitCafeReceiptStatus = z.infer<typeof gitCafeReceiptStatusSchema>;

export const gitCafeEventSkipReasonSchema = z.enum([
	"unarmed",
	"self",
	"maintainer-exemption",
	"no-matching-workflow",
	"unsupported-event",
	"stale-subject",
	"superseded",
	"legacy-unclassified",
	"rerun-not-evaluated",
]);
export type GitCafeEventSkipReason = z.infer<
	typeof gitCafeEventSkipReasonSchema
>;

export const gitCafeEventSettlementSchema = z.discriminatedUnion("status", [
	z.strictObject({ status: z.literal("completed"), runId: z.uuid() }),
	z.strictObject({
		status: z.literal("skipped"),
		reason: gitCafeEventSkipReasonSchema,
		runId: z.uuid().optional(),
	}),
	z.strictObject({
		status: z.literal("quarantined"),
		reason: z.enum([
			"invalid-retained-data",
			"invalid-event",
			"preparation-refused",
		]),
	}),
]);
export type GitCafeEventSettlement = z.infer<
	typeof gitCafeEventSettlementSchema
>;

export const gitCafeRecoverySelectionSchema = z.strictObject({
	environment: z.literal("preview"),
	appId: z.literal(GITCAFE_RECEIPT_APP_ID),
	organizationId: z.uuid(),
	installationId: gitCafeEventEnvelopeSchema.shape.installation.shape.id,
	repositoryId: z.string().min(1).max(255),
	receiptIds: z.array(z.uuid()).min(1).max(100),
});
export type GitCafeRecoverySelection = z.infer<
	typeof gitCafeRecoverySelectionSchema
>;

export const gitCafeRecoveryClassificationSchema = z.enum([
	"eligible",
	"already-pending",
	"supported-but-parked",
	"deliberately-skipped",
	"quarantined",
	"completed-with-run",
	"completed-without-run",
	"revoked-authority",
	"binding-mismatch",
	"missing",
	"unsupported",
]);
export type GitCafeRecoveryClassification = z.infer<
	typeof gitCafeRecoveryClassificationSchema
>;

export const gitCafeRecoveryAuditSchema = z.strictObject({
	requestId: z.uuid(),
	operator: z.string().min(1).max(255),
	reason: z.string().min(1).max(500),
	selection: gitCafeRecoverySelectionSchema,
	receiptId: z.uuid(),
	originalStatus: gitCafeReceiptStatusSchema,
	classification: gitCafeRecoveryClassificationSchema,
	retryWithoutRun: z.boolean().default(false),
	bodySha256: z.string().nullable(),
	eventIds: z.array(z.uuid()),
	runIds: z.array(z.uuid()),
	originalSettlements: z.array(
		z.strictObject({
			eventId: z.uuid(),
			settlement: gitCafeEventSettlementSchema.nullable(),
		}),
	),
});
export type GitCafeRecoveryAudit = z.infer<typeof gitCafeRecoveryAuditSchema>;

export const gitCafeRecoveryRequestSchema = z.strictObject({
	selection: gitCafeRecoverySelectionSchema,
	operator: gitCafeRecoveryAuditSchema.shape.operator,
	reason: gitCafeRecoveryAuditSchema.shape.reason,
	requestId: z.uuid(),
	retryWithoutRun: z.boolean().default(false),
});
export type GitCafeRecoveryRequest = z.infer<
	typeof gitCafeRecoveryRequestSchema
>;

export const gitCafeRecoveryItemSchema = z.strictObject({
	receiptId: z.uuid(),
	classification: gitCafeRecoveryClassificationSchema,
	status: gitCafeReceiptStatusSchema.nullable(),
	bodySha256: z.string().nullable(),
	eventIds: z.array(z.uuid()),
	runIds: z.array(z.uuid()),
	providerEventId: z.string().nullable(),
	deliveryId: z.string().nullable(),
	eventType: z.string().nullable(),
	receivedAt: z.iso.datetime().nullable(),
	events: z.array(
		z.strictObject({
			id: z.uuid(),
			normalized: z.boolean(),
			processed: z.boolean(),
			quarantined: z.boolean(),
			settlement: gitCafeEventSettlementSchema.nullable(),
		}),
	),
	jobs: z.array(
		z.strictObject({
			id: z.uuid(),
			queue: z.string(),
			state: z.string(),
			attempts: z.number().int().nonnegative(),
		}),
	),
	actions: z.array(
		z.strictObject({
			id: z.uuid(),
			runId: z.uuid(),
			status: z.string(),
			externalId: z.string().nullable(),
		}),
	),
});
export type GitCafeRecoveryItem = z.infer<typeof gitCafeRecoveryItemSchema>;

export const gitCafeOperationalSummarySchema = z.strictObject({
	pendingReceipts: z.number().int().nonnegative(),
	dispatchedReceipts: z.number().int().nonnegative(),
	parkedReceipts: z.number().int().nonnegative(),
	unprocessedEvents: z.number().int().nonnegative(),
	eventsWithoutLiveJobs: z.number().int().nonnegative(),
	oldestReceiptAgeSeconds: z.number().nonnegative().nullable(),
	oldestEventAgeSeconds: z.number().nonnegative().nullable(),
	oldestActionAgeSeconds: z.number().nonnegative().nullable(),
	heartbeatAgeSeconds: z.number().nonnegative().nullable(),
	queues: z.array(
		z.strictObject({
			state: z.enum(["created", "retry", "active", "failed"]),
			count: z.number().int().nonnegative(),
			oldestAgeSeconds: z.number().nonnegative(),
		}),
	),
});
export type GitCafeOperationalSummary = z.infer<
	typeof gitCafeOperationalSummarySchema
>;

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
