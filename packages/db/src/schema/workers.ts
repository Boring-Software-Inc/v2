import {
	bigint,
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const workerDeployments = pgTable("worker_deployments", {
	deploymentId: text("deployment_id").primaryKey(),
	firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const aiProviderStatus = pgTable("ai_provider_status", {
	provider: text("provider").primaryKey(),
	credits: text("credits", { enum: ["ready", "out"] }).notNull(),
	checkedAt: timestamp("checked_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	changedAt: timestamp("changed_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * Whether each operational alert (queue backlog, worker down) is firing. Every
 * api replica samples the queues; only the one whose update flips `firing`
 * posts the alert, so a page goes out once however many replicas run.
 */
export const opsAlerts = pgTable("ops_alerts", {
	key: text("key").primaryKey(),
	firing: boolean("firing").notNull(),
	changedAt: timestamp("changed_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * GitHub deliveries the delivery audit found ingest never stored. Only
 * problems get a row; a stored delivery leaves none.
 * - `redelivered`: every attempt failed, so the audit asked GitHub to send it
 *   again.
 * - `failed`: the redelivery failed too.
 * - `missed`: ingest answered 200 but stored nothing, though the delivery
 *   should have produced an event.
 * - `recovered`: it was stored later, usually by the redelivery.
 */
export const githubDeliveryAudit = pgTable(
	"github_delivery_audit",
	{
		guid: text("guid").primaryKey(),
		/** GitHub's id for the attempt the audit last acted on. */
		attemptId: bigint("attempt_id", { mode: "number" }).notNull(),
		event: text("event").notNull(),
		action: text("action"),
		installationId: text("installation_id"),
		repositoryId: text("repository_id"),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull(),
		status: text("status", {
			enum: ["redelivered", "failed", "missed", "recovered"],
		}).notNull(),
		statusCode: integer("status_code"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("github_delivery_audit_status_idx").on(t.status, t.updatedAt)],
);

/** How far each periodic scan has read, by scan name. */
export const opsCursors = pgTable("ops_cursors", {
	key: text("key").primaryKey(),
	position: timestamp("position", { withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
