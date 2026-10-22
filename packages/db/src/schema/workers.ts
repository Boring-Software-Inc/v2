import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const workerDeployments = pgTable("worker_deployments", {
	deploymentId: text("deployment_id").primaryKey(),
	firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
