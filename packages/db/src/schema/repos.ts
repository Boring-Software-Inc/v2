import {
	boolean,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Repos + per-repo rule configs + workflow definitions (spec §4). A repo row
 * is created by installation sync; nothing here references a GitHub id as a
 * USER identifier (§10) — `externalId`/`installationId` identify the repo and
 * App installation on the forge, never a person.
 */
export const repos = pgTable(
	"repos",
	{
		id: text("id").primaryKey(),
		forge: text("forge").notNull().default("github"),
		/** The forge's repo id, as a string. */
		externalId: text("external_id").notNull(),
		owner: text("owner").notNull(),
		name: text("name").notNull(),
		fullName: text("full_name").notNull(),
		private: boolean("private").notNull().default(false),
		/** GitHub App installation that grants access. */
		installationId: text("installation_id"),
		installedAt: timestamp("installed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** Soft removal on uninstall — history stays interpretable. */
		removedAt: timestamp("removed_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("repos_forge_external_unique").on(t.forge, t.externalId),
		uniqueIndex("repos_forge_full_name_unique").on(t.forge, t.fullName),
	],
);

export const ruleConfigs = pgTable(
	"rule_configs",
	{
		id: text("id").primaryKey(),
		repoId: text("repo_id")
			.notNull()
			.references(() => repos.id),
		/** Rule id WITHOUT version, e.g. "account-age". */
		ruleId: text("rule_id").notNull(),
		/** Pinned rule version (versioning law, §6). */
		version: integer("version").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		/** Validated against the rule's Zod config schema on write. */
		config: jsonb("config").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [uniqueIndex("rule_configs_repo_rule_unique").on(t.repoId, t.ruleId)],
);

export const workflowDefinitions = pgTable("workflow_definitions", {
	id: text("id").primaryKey(),
	repoId: text("repo_id")
		.notNull()
		.references(() => repos.id),
	name: text("name").notNull(),
	enabled: boolean("enabled").notNull().default(true),
	/** The JSON DAG (contracts `workflowDefinitionSchema`, validated on write). */
	definition: jsonb("definition").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
