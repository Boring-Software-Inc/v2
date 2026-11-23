import type {
	GitCafeLifecycleStatus,
	GitCafeReceipt,
	GitCafeReceiptStatus,
	GitCafeRecoveryAudit,
} from "@tripwire/contracts";
import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/** Receipt admission cannot enqueue the normal event pipeline. */
export const gitCafeReceipts = pgTable(
	"gitcafe_receipts",
	{
		id: text("id").primaryKey(),
		installationId: text("installation_id").notNull(),
		eventId: text("event_id").notNull(),
		deliveryId: text("delivery_id").notNull(),
		eventType: text("event_type").notNull(),
		receipt: jsonb("receipt").$type<GitCafeReceipt>().notNull(),
		status: text("status")
			.$type<GitCafeReceiptStatus>()
			.notNull()
			.default("pending"),
		receivedAt: timestamp("received_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		recoveryAttempts: integer("recovery_attempts").notNull().default(0),
		nextRecoveryAt: timestamp("next_recovery_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("gitcafe_receipts_installation_event_unique").on(
			t.installationId,
			t.eventId,
		),
		index("gitcafe_receipts_installation_status_idx").on(
			t.installationId,
			t.status,
		),
	],
);

/** Provider event time and a local generation fence delayed events and in-flight lookups. */
export const gitCafeInstallationLifecycle = pgTable(
	"gitcafe_installation_lifecycle",
	{
		installationId: text("installation_id").primaryKey(),
		status: text("status").$type<GitCafeLifecycleStatus>().notNull(),
		generation: integer("generation").notNull().default(1),
		lastEventAt: timestamp("last_event_at", { withTimezone: true }),
		lastEventId: text("last_event_id"),
		authorityAt: timestamp("authority_at", { withTimezone: true }),
		providerVersion: integer("provider_version"),
		providerRevision: integer("provider_revision"),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
);

export const gitCafeRecoveryAudit = pgTable(
	"gitcafe_recovery_audit",
	{
		id: text("id").primaryKey(),
		receiptId: text("receipt_id").notNull(),
		requestId: text("request_id").notNull(),
		audit: jsonb("audit").$type<GitCafeRecoveryAudit>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("gitcafe_recovery_audit_request_receipt_unique").on(
			t.requestId,
			t.receiptId,
		),
	],
);

export const gitCafeRuntimeHeartbeats = pgTable("gitcafe_runtime_heartbeats", {
	runtimeId: text("runtime_id").primaryKey(),
	release: text("release").notNull(),
	mode: text("mode").notNull(),
	progressAt: timestamp("progress_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
