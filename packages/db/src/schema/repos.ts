import {
	boolean,
	index,
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
		/**
		 * §4 arming — a repo is gated ONLY when explicitly armed. DEFAULT FALSE:
		 * installing on an org syncs every repo, but tripwire touches none of them
		 * until the maintainer arms it. Picking a repo (onboarding) scopes the
		 * dashboard; it does NOT arm it. An unarmed repo still ingests events (the
		 * append-only store stays complete for arm-time backfill) — only the RUN
		 * is skipped, the same shape as the maintainer-exemption path.
		 */
		armed: boolean("armed").notNull().default(false),
		/**
		 * §4 arm-time backfill progress. Non-null `backfillTotal` ⇒ a backfill is
		 * in flight (or just finished); the UI shows "backfilling — done of total".
		 * Null when idle. Set when arming enqueues the replay, cleared when done.
		 */
		backfillTotal: integer("backfill_total"),
		backfillDone: integer("backfill_done"),
		/** GitHub App installation that grants access. */
		installationId: text("installation_id"),
		/**
		 * Owning org (§org-model), denormalized from the installation's org at
		 * sync/claim so scope queries are one hop. NULL is a legitimate long-term
		 * state — a GitHub-side install nobody has claimed yet. Org-scoped queries
		 * are null-safe by construction: they filter `org_id = $org`, which a NULL
		 * can never match. No drizzle-level FK: organizations.ts imports auth.ts
		 * which imports this file — the org service enforces referential integrity
		 * at claim time instead of adding a three-module import cycle.
		 */
		orgId: text("org_id"),
		installedAt: timestamp("installed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** Soft removal on uninstall — history stays interpretable. */
		removedAt: timestamp("removed_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("repos_forge_external_unique").on(t.forge, t.externalId),
		uniqueIndex("repos_forge_full_name_unique").on(t.forge, t.fullName),
		index("repos_org_id_idx").on(t.orgId),
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

export const responseConfigs = pgTable(
	"response_configs",
	{
		id: text("id").primaryKey(),
		repoId: text("repo_id")
			.notNull()
			.references(() => repos.id),
		/** Validated against contracts `responseConfigSchema` on write; an absent
		 * row (or a corrupt one) resolves to the defaults at read time. */
		config: jsonb("config").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [uniqueIndex("response_configs_repo_unique").on(t.repoId)],
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
