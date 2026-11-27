import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
