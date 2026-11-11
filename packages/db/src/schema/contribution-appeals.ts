import type { ContributionAppealStatus } from "@tripwire/contracts";
import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { repos } from "./repos.ts";
import { runs } from "./runs.ts";

export const contributionAppeals = pgTable(
	"contribution_appeals",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => runs.id, { onDelete: "cascade" }),
		repoId: text("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		subjectKind: text("subject_kind")
			.$type<"issue" | "change-request">()
			.notNull(),
		subjectNumber: integer("subject_number").notNull(),
		accountId: text("account_id").notNull(),
		login: text("login").notNull(),
		reason: text("reason").notNull(),
		status: text("status")
			.$type<ContributionAppealStatus>()
			.notNull()
			.default("pending"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		decidedAt: timestamp("decided_at", { withTimezone: true }),
		decidedBy: text("decided_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		uniqueIndex("contribution_appeals_run_unique").on(table.runId),
		index("contribution_appeals_repo_status_idx").on(
			table.repoId,
			table.status,
		),
		index("contribution_appeals_thread_idx").on(
			table.repoId,
			table.subjectKind,
			table.subjectNumber,
			table.accountId,
		),
	],
);
