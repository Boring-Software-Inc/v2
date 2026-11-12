import type {
	AppealPortalSettings,
	ContributionAppealStatus,
	OrganizationAppealType,
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
import { user } from "./auth.ts";
import { organization } from "./organizations.ts";
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

export const organizationAppeals = pgTable(
	"organization_appeals",
	{
		id: text("id").primaryKey(),
		orgId: text("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		accountId: text("account_id").notNull(),
		type: text("type").$type<OrganizationAppealType>().notNull(),
		reason: text("reason").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolvedBy: text("resolved_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("organization_appeals_org_resolved_idx").on(
			table.orgId,
			table.resolvedAt,
		),
		index("organization_appeals_account_resolved_idx").on(
			table.accountId,
			table.resolvedAt,
		),
	],
);

export const organizationAppealPortalSettings = pgTable(
	"organization_appeal_portal_settings",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		settings: jsonb("settings").$type<AppealPortalSettings>().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
);
