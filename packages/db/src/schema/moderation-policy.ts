import {
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "./organizations.ts";
import { repos } from "./repos.ts";

export const organizationModerationPolicies = pgTable(
	"organization_moderation_policies",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** Writes validate against orgModerationPolicySchema. */
		policy: jsonb("policy").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
);

export const repositoryModerationPolicies = pgTable(
	"repository_moderation_policies",
	{
		repoId: text("repo_id")
			.primaryKey()
			.references(() => repos.id, { onDelete: "cascade" }),
		/** Writes validate against repoModerationPolicySchema. */
		policy: jsonb("policy").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
);

export const repositoryAllowlistEntries = pgTable(
	"repository_allowlist_entries",
	{
		repoId: text("repo_id")
			.notNull()
			.references(() => repos.id, { onDelete: "cascade" }),
		accountId: text("account_id").notNull(),
		login: text("login").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.repoId, t.accountId] })],
);
