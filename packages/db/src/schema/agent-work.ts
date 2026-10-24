import type {
	AgentNodeTouch,
	WorkflowChangeSet,
	WorkflowDraftStatus,
} from "@tripwire/contracts";
import { sql } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { repos, workflowDefinitions } from "./repos.ts";

/**
 * A workflow an agent is building. It lives apart from workflow_definitions,
 * so nothing that runs workflows can ever read it. One open draft per
 * workflow, keyed by the definition's wire id.
 */
export const workflowDrafts = pgTable(
	"workflow_drafts",
	{
		id: text("id").primaryKey(),
		repoId: text("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		definitionId: text("definition_id").notNull(),
		workflowId: text("workflow_id").references(() => workflowDefinitions.id, {
			onDelete: "set null",
		}),
		name: text("name").notNull(),
		definition: jsonb("definition"),
		status: text("status")
			.$type<WorkflowDraftStatus>()
			.notNull()
			.default("open"),
		revision: integer("revision").notNull().default(0),
		lastChange: jsonb("last_change").$type<WorkflowChangeSet>(),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		agentClientId: text("agent_client_id"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		uniqueIndex("workflow_drafts_open_unique")
			.on(t.repoId, t.definitionId)
			.where(sql`${t.status} = 'open'`),
		index("workflow_drafts_repo_idx").on(t.repoId),
	],
);

/** Which nodes an agent touches on a workflow right now, and when. */
export const agentActivity = pgTable(
	"agent_activity",
	{
		id: text("id").primaryKey(),
		repoId: text("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		definitionId: text("definition_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		clientId: text("client_id").notNull(),
		nodes: jsonb("nodes").$type<AgentNodeTouch[]>().notNull().default([]),
		startedAt: timestamp("started_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		lastSignalAt: timestamp("last_signal_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("agent_activity_agent_unique").on(
			t.repoId,
			t.definitionId,
			t.userId,
			t.clientId,
		),
		index("agent_activity_repo_signal_idx").on(t.repoId, t.lastSignalAt),
	],
);
