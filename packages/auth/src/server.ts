import { dash } from "@better-auth/infra";
import {
	forgeSchema,
	orgSlugSchema,
	SIGN_IN_FORGE_IDS,
} from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { orgServices, schema } from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, genericOAuth } from "better-auth/plugins";
import { organization } from "better-auth/plugins/organization";
import { eq } from "drizzle-orm";
import { applySignupAccessDefaults } from "./access.ts";
import { orgAc, orgRoles } from "./org-access.ts";

/**
 * Better Auth (§10): GitHub OAuth only at launch. One `createAuth` shared by
 * the heads that need it (api mounts the HTTP handler, web reads sessions) —
 * stateless instances over the same database. `user.id` is UUIDv7; GitHub
 * identity lives ONLY in `account` (sign-in) and `forge_identities`.
 * Contributors never authenticate — only maintainers log in.
 */

export interface CreateAuthInput {
	db: Db;
	secret: string;
	baseUrl: string;
	github: { clientId: string; clientSecret: string } | null;
	/**
	 * open-git OAuth, or null when the creds are absent. Goes through the
	 * genericOAuth plugin rather than a built-in provider: better-auth has no
	 * open-git provider, but open-git ships OIDC discovery + PKCE, so the generic
	 * path covers it with no bespoke exchange code.
	 *
	 * `origin` points a self-hosted instance at its own URL; omit for
	 * open-git.com. Sign-in ONLY — there is no adapter, so an open-git identity
	 * cannot own a repo (see FORGE_CATALOG: `status: planned`, `signIn: oauth2`).
	 */
	opengit: { clientId: string; clientSecret: string; origin?: string } | null;
	/**
	 * Better Auth Infrastructure API key (BETTER_AUTH_API_KEY). Lets the dash()
	 * connector reach the infra service; absent (dev / unset) ⇒ dash stays
	 * inert. Injected by the heads — packages/auth never reads env itself.
	 */
	infraApiKey?: string;
	/**
	 * DEV ONLY — enable email/password so the dev persona switcher can mint a
	 * REAL session without the OAuth round-trip (§13). The web head passes
	 * `import.meta.env.DEV`, so production builds never enable it (the sign-up /
	 * sign-in endpoints are absent). Never set this true in a real deployment.
	 */
	devLogin?: boolean;
}

export function createAuth(input: CreateAuthInput) {
	return betterAuth({
		database: drizzleAdapter(input.db, {
			provider: "pg",
			schema: {
				user: schema.user,
				session: schema.session,
				account: schema.account,
				verification: schema.verification,
				organization: schema.organization,
				member: schema.member,
				invitation: schema.invitation,
			},
		}),
		secret: input.secret,
		baseURL: input.baseUrl,
		session: {
			cookieCache: {
				enabled: true,
				maxAge: 5 * 60,
			},
		},
		// Dev persona switcher only — off unless the web head is a dev build.
		emailAndPassword: { enabled: input.devLogin ?? false },
		// One maintainer can carry a GitHub AND a GitLab identity, so link social
		// accounts that share a verified email into ONE user — `forge_identities`
		// then holds a row per forge (§10). Only forge providers are trusted, and
		// the enum is the source, so a new forge is trusted with no edit here.
		// Same-email is required (allowDifferentEmails defaults false), which
		// blocks linking an unrelated account.
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: [...SIGN_IN_FORGE_IDS],
			},
		},
		advanced: {
			database: {
				generateId: () => generateId(),
			},
		},
		socialProviders: {
			...(input.github
				? {
						github: {
							clientId: input.github.clientId,
							clientSecret: input.github.clientSecret,
						},
					}
				: {}),
		},
		user: {
			// Closed-beta access queue. `input: false` means a client can never set
			// these through the signup/update payload — only server code (the create
			// hook + the promote path) writes them.
			additionalFields: {
				accessStatus: {
					type: "string",
					required: false,
					defaultValue: "pending",
					input: false,
				},
				accessReviewedAt: { type: "date", required: false, input: false },
				accessReviewedBy: { type: "string", required: false, input: false },
				waitlistedAt: { type: "date", required: false, input: false },
				/**
				 * Platform staff bit — the most privileged field in the system.
				 * `input: false` keeps it out of every client payload; the only
				 * write path is the grant-admin CLI script.
				 */
				isPlatformAdmin: {
					type: "boolean",
					required: false,
					defaultValue: false,
					input: false,
				},
				/**
				 * Staff flag: skip re-run cooldown. `input: false` — only
				 * /admin/users writes this via staffServices.
				 */
				rerunCooldownExempt: {
					type: "boolean",
					required: false,
					defaultValue: false,
					input: false,
				},
			},
		},
		plugins: [
			...(input.opengit
				? [
						genericOAuth({
							config: [
								{
									// The provider id IS the forge id, so account.providerId lines
									// up with the catalog and the callback path is
									// /oauth2/callback/opengit.
									providerId: "opengit",
									clientId: input.opengit.clientId,
									clientSecret: input.opengit.clientSecret,
									// Discovery over hand-written endpoints: open-git serves
									// /.well-known/openid-configuration, so the URLs stay right
									// even if they move.
									discoveryUrl: `${(input.opengit.origin ?? "https://open-git.com").replace(/\/$/, "")}/.well-known/openid-configuration`,
									scopes: ["openid", "profile", "email"],
									pkce: true,
								},
							],
						}),
					]
				: []),
			organization({
				ac: orgAc,
				roles: orgRoles,
				/**
				 * Two roles only (§org-model): the creator is a plain admin — there
				 * is no owner tier. The leave route's built-in "last creatorRole"
				 * guard therefore doubles as our last-admin-on-leave guard.
				 */
				creatorRole: "admin",
				/**
				 * Deletion is disabled plugin-wide: the spec requires typed-name
				 * confirmation server-side + an enumerated cascade, which the raw
				 * plugin endpoint cannot verify. Deletion happens ONLY through our
				 * admin-gated server fn → orgServices.deleteOrganization.
				 */
				disableOrganizationDeletion: true,
				schema: {
					organization: {
						additionalFields: {
							isPersonal: {
								type: "boolean",
								required: false,
								defaultValue: false,
								input: false,
							},
							avatarHue: { type: "number", required: false },
						},
					},
				},
				organizationHooks: {
					/** Team-org creation (plugin path): hold the slug line. Personal
					 * orgs never come through here — they're direct inserts. */
					beforeCreateOrganization: async ({ organization: org }) => {
						if (org.slug) {
							const parsed = orgSlugSchema.safeParse(org.slug);
							if (!parsed.success) {
								throw new Error(
									parsed.error.issues[0]?.message ?? "invalid slug",
								);
							}
						}
						return { data: { ...org, isPersonal: false } };
					},
					/** Rename/slug-change (admin-gated by AC): same slug line, and the
					 * server-set flags stay server-set. */
					beforeUpdateOrganization: async ({ organization: patch }) => {
						if (patch.slug) {
							const parsed = orgSlugSchema.safeParse(patch.slug);
							if (!parsed.success) {
								throw new Error(
									parsed.error.issues[0]?.message ?? "invalid slug",
								);
							}
						}
						const { isPersonal: _ignored, ...rest } = patch;
						return { data: rest };
					},
					/** §1: a personal org has exactly one member, forever. */
					beforeAddMember: async ({ organization: org, member }) => {
						if (org.isPersonal) {
							throw new Error("personal orgs cannot add members");
						}
						if (member.role !== "admin" && member.role !== "member") {
							throw new Error("unknown role");
						}
					},
					/** Last-admin guard on removal (covers the remove endpoint; the
					 * leave endpoint has its own creatorRole guard). */
					beforeRemoveMember: async ({ organization: org, member }) => {
						if (org.isPersonal) {
							throw new Error("cannot leave or edit a personal org");
						}
						if (member.role.split(",").includes("admin")) {
							const admins = await orgServices.countAdmins(input.db, org.id);
							if (admins <= 1) {
								throw new Error("an org must keep at least one admin");
							}
						}
					},
					/**
					 * Last-admin guard on demotion + two-role enforcement — shared with
					 * the staff portal path (updateMemberRoleForStaff) so both routes
					 * enforce identical invariants from ONE guard.
					 */
					beforeUpdateMemberRole: async ({
						organization: org,
						member,
						newRole,
					}) => {
						await orgServices.assertRoleChangeAllowed(input.db, {
							orgId: org.id,
							isPersonal: Boolean(org.isPersonal),
							currentRole: member.role,
							newRole,
						});
					},
					/** Tripwire invites are token LINKS (organization_invite_links) —
					 * the plugin's email-invitation path is hard-refused so its raw
					 * HTTP endpoints stay dead. */
					beforeCreateInvitation: async () => {
						throw new Error(
							"email invitations are disabled — use invite links",
						);
					},
				},
			}),
			/**
			 * Better Auth `admin` plugin — backs dash's user management (ban /
			 * unban / impersonate / set-role) and adds the banned-on-sign-in
			 * check. defaultRole "user" + no account carrying "admin" keeps the
			 * raw /api/auth/admin/* endpoints deny-by-default; the app's own
			 * isPlatformAdmin staff model is unchanged.
			 */
			admin(),
			/**
			 * Better Auth Infrastructure dashboard connector — mounts the /dash/*
			 * admin + audit endpoints and streams auth events to the infra API.
			 * Needs BETTER_AUTH_API_KEY to reach the service; inert without it.
			 * activityTracking stays off, so no schema change.
			 */
			dash({ apiKey: input.infraApiKey }),
		],
		databaseHooks: {
			user: {
				create: {
					/** New signups land in the access queue as "pending" (server-set). */
					before: async (user) => {
						return { data: applySignupAccessDefaults(user, null) };
					},
					/** §1: every user gets a personal org at signup (idempotent —
					 * the migration backfill uses the same service). */
					after: async (user) => {
						await orgServices.ensurePersonalOrg(input.db, {
							userId: user.id,
							name: user.name,
						});
					},
				},
			},
			account: {
				create: {
					/** §10: mirror the forge identity into forge_identities. One row
					 * per (forge, external id). A provider with no forge (none today)
					 * is ignored, not guessed. */
					after: async (account) => {
						// Better Auth's provider id IS the forge slug ("github",
						// "gitlab"), so the forgeSchema enum validates it directly — no
						// map to maintain. A non-forge provider (e.g. dev credentials)
						// fails the parse and is skipped, not guessed. Add a forge = add
						// it to forgeSchema; this hook needs no edit.
						const forge = forgeSchema.safeParse(account.providerId);
						if (!forge.success) {
							return;
						}
						const users = await input.db
							.select()
							.from(schema.user)
							.where(eqUserId(account.userId));
						const username = users[0]?.name ?? account.userId;
						await input.db
							.insert(schema.forgeIdentities)
							.values({
								id: generateId(),
								userId: account.userId,
								forge: forge.data,
								externalId: account.accountId,
								username,
							})
							.onConflictDoNothing();
					},
				},
			},
		},
	});
}

function eqUserId(userId: string) {
	return eq(schema.user.id, userId);
}

export type Auth = ReturnType<typeof createAuth>;

export type AuthPosture = "enabled" | "open-dev";

/**
 * Fail-closed guard (hardening unit 2): the open-gate fallback exists ONLY
 * for local dev before the OAuth app exists. In production a missing
 * BETTER_AUTH_SECRET refuses to boot — a missing env var must never silently
 * publish the dashboard.
 */
export function resolveAuthPosture(input: {
	secret: string | undefined;
	nodeEnv: string | undefined;
}): AuthPosture {
	if (input.secret) {
		return "enabled";
	}
	if (input.nodeEnv === "production") {
		throw new Error(
			"BETTER_AUTH_SECRET is not set — refusing to serve in production (auth gate would stand open)",
		);
	}
	return "open-dev";
}
