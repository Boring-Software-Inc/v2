import type { WorkflowPushStatus } from "@tripwire/contracts";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { organization } from "./organizations.ts";
import { repos } from "./repos.ts";

export const workflowPushProposals = pgTable(
	"workflow_push_proposals",
	{
		id: text("id").primaryKey(),
		orgId: text("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		repoId: text("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		entries: jsonb("entries").notNull(),
		status: text("status")
			.$type<WorkflowPushStatus>()
			.notNull()
			.default("pending"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		decidedBy: text("decided_by").references(() => user.id, {
			onDelete: "set null",
		}),
		decidedAt: timestamp("decided_at", { withTimezone: true }),
		outcomes: jsonb("outcomes"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("workflow_push_proposals_repo_idx").on(t.repoId)],
);
