import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { runs } from "./runs.ts";

/**
 * Moderation items = paused runs (spec §6). A `needs_review` verdict halts the
 * run and creates a row here; approve/deny resumes the run down the
 * corresponding edge. Not a separate system.
 */
export const moderationItems = pgTable(
	"moderation_items",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => runs.id),
		/** The workflow node that paused the run — resume continues from here. */
		nodeId: text("node_id").notNull(),
		/** pending → approved | denied. */
		status: text("status").notNull().default("pending"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		decidedAt: timestamp("decided_at", { withTimezone: true }),
		/** The maintainer who decided — FK to user.id (UUIDv7), never a forge id. */
		decidedBy: text("decided_by").references(() => user.id),
		note: text("note"),
	},
	(t) => [index("moderation_items_status_idx").on(t.status)],
);
