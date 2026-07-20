import { orgSlugSchema } from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { orgServices, schema } from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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
		advanced: {
			database: {
				generateId: () => generateId(),
			},
		},
		socialProviders: input.github
			? {
					github: {
						clientId: input.github.clientId,
						clientSecret: input.github.clientSecret,
					},
				}
			: {},
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
			},
		},
		plugins: [
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
					/** §10: mirror the GitHub identity into forge_identities. */
					after: async (account) => {
						if (account.providerId !== "github") {
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
								forge: "github",
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
