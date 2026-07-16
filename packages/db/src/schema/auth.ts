import type { AccessStatus } from "@tripwire/contracts";
import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { repos } from "./repos.ts";

/**
 * Better Auth core tables (§10) + forge_identities. Column set follows Better
 * Auth's drizzle adapter schema. `user.id` is a UUIDv7 string — domain tables
 * FK to it and NEVER to a GitHub id. GitHub identity lives in exactly two
 * places: `account` (sign-in) and `forge_identities`.
 */
export const user = pgTable(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull().unique(),
		emailVerified: boolean("email_verified").notNull().default(false),
		image: text("image"),
		/**
		 * The ONE repo this user's dashboard is scoped to (§10 onboarding). Null
		 * until they finish onboarding. All granted repos stay synced as `repos`
		 * rows; only this one is active (MVP — no switcher).
		 */
		activeRepoId: text("active_repo_id").references(() => repos.id),
		/**
		 * Closed-beta access gate. Server-assigned only (Better Auth `input: false`
		 * + the create hook); new signups default to "pending".
		 */
		accessStatus: text("access_status")
			.$type<AccessStatus>()
			.notNull()
			.default("pending"),
		accessReviewedAt: timestamp("access_reviewed_at", { withTimezone: true }),
		accessReviewedBy: text("access_reviewed_by"),
		waitlistedAt: timestamp("waitlisted_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("user_access_status_idx").on(t.accessStatus)],
);

/**
 * Which App installation belongs to which user (§10 onboarding). The Setup URL
 * callback writes this from the SIGNED-IN session — an installation with no
 * owner is a bug, so `(forge, installationId)` is unique. Repos are reached
 * through this: `repos.installationId = user_installations.installationId`.
 */
export const userInstallations = pgTable(
	"user_installations",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		forge: text("forge").notNull().default("github"),
		/** The GitHub App installation id, as a string. */
		installationId: text("installation_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("user_installations_forge_installation_unique").on(
			t.forge,
			t.installationId,
		),
	],
);

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	/**
	 * Better Auth organization-plugin field. Tripwire does NOT scope by it —
	 * the URL is the source of truth (§8); this is only the "last visited"
	 * breadcrumb the `/` redirect may consult. Plain text on purpose: a stale
	 * id falls back to the personal org, no FK integrity needed.
	 */
	activeOrganizationId: text("active_organization_id"),
	token: text("token").notNull().unique(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", {
		withTimezone: true,
	}),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
		withTimezone: true,
	}),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * Forge identities (§10) — present from day 1, GitHub-only rows for now.
 * GitLab later = allow a second row per user. Zero migration.
 */
export const forgeIdentities = pgTable(
	"forge_identities",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		forge: text("forge").notNull().default("github"),
		/** The forge's account id, as a string. Never used as a user identifier. */
		externalId: text("external_id").notNull(),
		username: text("username").notNull(),
		credentials: jsonb("credentials"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("forge_identities_forge_external_unique").on(
			t.forge,
			t.externalId,
		),
	],
);
