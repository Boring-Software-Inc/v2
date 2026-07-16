import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * Organizations (§org-model). The first three tables follow Better Auth's
 * organization-plugin drizzle shape (the adapter works off these property
 * names) plus our `additionalFields` (isPersonal, avatarHue). Everything a
 * user reaches — installations, repos, config, history — hangs off an org;
 * users get access through `member` rows. Exactly two roles: admin, member.
 *
 * `invitation` exists because the plugin requires it, but it is DORMANT — no
 * `sendInvitationEmail` is configured and no UI calls its endpoints. Tripwire
 * invites are shareable token LINKS (`organization_invite_links`, ours): no
 * email, hashed token, multi-use with maxUses, revocable.
 */
export const organization = pgTable(
	"organization",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		/** URL identity (/:slug/…). Validated by contracts' orgSlugSchema. */
		slug: text("slug").notNull().unique(),
		logo: text("logo"),
		metadata: text("metadata"),
		/**
		 * Personal orgs: auto-created at signup, exactly one member, cannot be
		 * left or deleted, cannot create invite links. One table + flag, not two
		 * concepts.
		 */
		isPersonal: boolean("is_personal").notNull().default(false),
		/**
		 * Optional hue override for the generated dither avatar. The avatar is
		 * DERIVED from the name at render — this is the only persisted avatar
		 * state.
		 */
		avatarHue: integer("avatar_hue"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("organization_is_personal_idx").on(t.isPersonal)],
);

export const member = pgTable(
	"member",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** "admin" | "member" (contracts orgRoleSchema). */
		role: text("role").notNull().default("member"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("member_org_user_unique").on(t.organizationId, t.userId),
		index("member_user_idx").on(t.userId),
	],
);

/** Plugin-required, dormant — see the module doc. Never surfaced in the UI. */
export const invitation = pgTable("invitation", {
	id: text("id").primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	email: text("email").notNull(),
	role: text("role"),
	status: text("status").notNull().default("pending"),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	inviterId: text("inviter_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * Tripwire's real invite primitive (§6): a shareable link, no email. The token
 * is stored HASHED (sha-256) — a leaked table cannot mint memberships. Carries
 * {org, role, expiresAt, maxUses}; single-use is maxUses=1. Redemption is
 * transactional with a guarded `uses` increment so concurrent redeems of the
 * last use cannot both win. `createdBy` is audit AND the beta-approval rule:
 * a redeemer is approved iff the creating admin's accessStatus is "approved"
 * AT REDEMPTION TIME (fresh read — no org-level approval concept exists).
 */
export const organizationInviteLinks = pgTable(
	"organization_invite_links",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull().unique(),
		/** Role the redeemer receives ("admin" | "member"). */
		role: text("role").notNull().default("member"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		maxUses: integer("max_uses").notNull().default(1),
		uses: integer("uses").notNull().default(0),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("org_invite_links_org_idx").on(t.organizationId)],
);

/**
 * Which App installation belongs to which ORG (§2/§3). `(forge, installationId)`
 * unique enforces §3 at the schema level: one GitHub installation maps to
 * exactly one platform org, never shared. Repos are reached through this:
 * `repos.installationId = organization_installations.installationId`, with
 * `repos.orgId` denormalized at sync/claim so scope queries are one hop.
 *
 * The webhook ingest path resolves installation→org→repos through THIS table
 * with zero user/session assumptions. A row may not exist yet for a
 * GitHub-side install nobody has claimed — those repos stay invisible (null
 * repos.orgId) until the claim screen binds them.
 */
export const organizationInstallations = pgTable(
	"organization_installations",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		forge: text("forge").notNull().default("github"),
		/** The GitHub App installation id, as a string. */
		installationId: text("installation_id").notNull(),
		/** GitHub account type the App is installed on ("User" | "Organization"). */
		accountType: text("account_type"),
		/** GitHub account login the App is installed on (display/confirm copy). */
		accountLogin: text("account_login"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("org_installations_forge_installation_unique").on(
			t.forge,
			t.installationId,
		),
		index("org_installations_org_idx").on(t.organizationId),
	],
);
