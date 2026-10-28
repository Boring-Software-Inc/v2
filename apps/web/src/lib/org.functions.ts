import { createServerFn } from "@tanstack/react-start";
import type { OrgWithPermissions } from "@tripwire/auth/org-gate";
import type { Auth } from "@tripwire/auth/server";
import type {
	CreateInviteInput,
	OrgRoleScopes,
	OrgScopeLevels,
} from "@tripwire/contracts";
import {
	customOrgRoleNameSchema,
	orgMemberRoleInputSchema,
	orgRoleInputSchema,
	scopesToStatements,
	statementsToScopes,
} from "@tripwire/contracts";
import type {
	InviteLinkView,
	OrgCascade,
	OrgWithRole,
	RedeemResult,
} from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	type OrgContext,
	orgMemberMiddleware,
	orgPermissionMiddleware,
} from "#/lib/server/org-guard";

export type {
	InviteLinkView,
	OrgCascade,
	OrgWithPermissions,
	OrgWithRole,
	RedeemResult,
};

/**
 * Org surface (§org-model). Membership/role mutations go through the Better
 * Auth plugin API (its hooks enforce the personal-org + last-admin
 * invariants); everything the plugin doesn't model (invite links, deletion
 * with typed-name confirm, installation claims) calls orgServices. Every fn
 * here carries the org slug as `data.org` — the role middlewares resolve it
 * fresh and hand the handler `context.org`.
 */

/** The $org layout's resolve: org + caller role, or the 404 the route shows. */
export const getOrgContext = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<OrgWithPermissions> => {
		return (context as OrgContext).org;
	});

export const rememberActiveOrg = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<void> => {
		const { getAuth } = await import("#/lib/server/auth");
		const auth = getAuth();
		if (!auth) {
			return;
		}
		const { getStartContext } = await import("@tanstack/start-storage-context");
		const current = await auth.api.getSession({
			headers: getStartContext().request.headers,
		});
		if (!current) {
			return;
		}
		const { getDb } = await import("#/lib/server/db");
		const { schema } = await import("@tripwire/db");
		const { eq } = await import("drizzle-orm");
		await getDb()
			.db.update(schema.session)
			.set({ activeOrganizationId: (context as OrgContext).org.id })
			.where(eq(schema.session.id, current.session.id));
	});

/** Every org the caller belongs to — the switcher. Personal first. */
export const listMyOrgs = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.handler(async (): Promise<OrgWithRole[]> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		if (!userId) {
			// open-dev: surface every org so local dev can navigate
			const { schema } = await import("@tripwire/db");
			const rows = await getDb()
				.db.select({
					id: schema.organization.id,
					slug: schema.organization.slug,
					name: schema.organization.name,
					isPersonal: schema.organization.isPersonal,
					avatarHue: schema.organization.avatarHue,
					timezone: schema.organization.timezone,
				})
				.from(schema.organization);
			return rows.map((r) => ({ ...r, role: "admin" as const }));
		}
		return await orgServices.listUserOrgs(getDb().db, userId);
	});

/** Create a team org (plugin path — hooks validate slug, force !isPersonal). */
export const createOrg = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator(
		(input: { name: string; slug: string; avatarHue?: number }) => input,
	)
	.handler(async ({ data }): Promise<{ slug: string } | { error: string }> => {
		const { getAuth } = await import("#/lib/server/auth");
		const auth = getAuth();
		if (!auth) {
			return {
				error:
					"Sign-in is off in open-dev mode, so this action is not available.",
			};
		}
		const { getStartContext } = await import("@tanstack/start-storage-context");
		try {
			const org = await auth.api.createOrganization({
				body: {
					name: data.name,
					slug: data.slug,
					...(data.avatarHue !== undefined
						? { avatarHue: data.avatarHue }
						: {}),
				},
				headers: getStartContext().request.headers,
			});
			return { slug: org?.slug ?? data.slug };
		} catch (err) {
			return {
				error:
					err instanceof Error
						? err.message
						: "Could not create the org. Try again.",
			};
		}
	});

/** Rename / re-slug (admin; the plugin hook re-validates the slug line). */
export const updateOrg = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("settings:manage"),
	])
	.inputValidator(
		(input: {
			org: string;
			name?: string;
			slug?: string;
			avatarHue?: number;
		}) => input,
	)
	.handler(
		async ({
			data,
			context,
		}): Promise<{ slug: string } | { error: string }> => {
			const org = (context as { org: OrgWithRole }).org;
			const { getAuth } = await import("#/lib/server/auth");
			const auth = getAuth();
			if (!auth) {
				return {
					error:
						"Sign-in is off in open-dev mode, so this action is not available.",
				};
			}
			const { getStartContext } = await import(
				"@tanstack/start-storage-context"
			);
			try {
				const updated = await auth.api.updateOrganization({
					body: {
						organizationId: org.id,
						data: {
							...(data.name !== undefined ? { name: data.name } : {}),
							...(data.slug !== undefined ? { slug: data.slug } : {}),
							...(data.avatarHue !== undefined
								? { avatarHue: data.avatarHue }
								: {}),
						},
					},
					headers: getStartContext().request.headers,
				});
				return { slug: updated?.slug ?? data.slug ?? org.slug };
			} catch (err) {
				return {
					error:
						err instanceof Error
							? err.message
							: "Could not save the org. Try again.",
				};
			}
		},
	);

/** What deletion touches — shown before the typed-name confirm. */
export const getOrgCascade = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("settings:manage"),
	])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<OrgCascade> => {
		const org = (context as { org: OrgWithRole }).org;
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		return await orgServices.enumerateOrgCascade(getDb().db, org.id);
	});

/**
 * Delete a team org. Server-verified typed-name confirmation (§5) — the
 * plugin's own delete endpoint is disabled; this is the only path.
 */
export const deleteOrg = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("settings:manage"),
	])
	.inputValidator((input: { org: string; confirmName: string }) => input)
	.handler(
		async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
			const org = (context as { org: OrgWithRole }).org;
			if (org.isPersonal) {
				return { ok: false, error: "You cannot delete a personal org." };
			}
			if (data.confirmName !== org.name) {
				return { ok: false, error: "Type the org name exactly to confirm." };
			}
			const { getDb } = await import("#/lib/server/db");
			const { orgServices } = await import("@tripwire/db");
			const { deleted } = await orgServices.deleteOrganization(
				getDb().db,
				org.id,
			);
			return { ok: deleted };
		},
	);

// ── members ─────────────────────────────────────────────────────────────

export interface OrgMemberView {
	memberId: string;
	userId: string;
	name: string;
	email: string;
	image: string | null;
	role: string;
	joinedAt: string;
}

export const listOrgMembers = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("members:read")])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<OrgMemberView[]> => {
		const org = (context as { org: OrgWithRole }).org;
		const { getDb } = await import("#/lib/server/db");
		const { schema } = await import("@tripwire/db");
		const { eq } = await import("drizzle-orm");
		const db = getDb().db;
		const rows = await db
			.select({
				memberId: schema.member.id,
				userId: schema.user.id,
				name: schema.user.name,
				email: schema.user.email,
				image: schema.user.image,
				role: schema.member.role,
				joinedAt: schema.member.createdAt,
			})
			.from(schema.member)
			.innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
			.where(eq(schema.member.organizationId, org.id))
			.orderBy(schema.member.createdAt);
		return rows.map((r) => ({
			...r,
			joinedAt: r.joinedAt.toISOString(),
		}));
	});

/** Role change via the plugin (hooks: last-admin + two-role enforcement). */
export const updateOrgMemberRole = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("members:manage"),
	])
	.inputValidator((input: { org: string; memberId: string; role: string }) => ({
		org: input.org,
		memberId: input.memberId,
		role: orgMemberRoleInputSchema.parse(input.role),
	}))
	.handler(
		async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
			const org = (context as { org: OrgWithRole }).org;
			const { getAuth } = await import("#/lib/server/auth");
			const auth = getAuth();
			if (!auth) {
				return {
					ok: false,
					error:
						"Sign-in is off in open-dev mode, so this action is not available.",
				};
			}
			const { getStartContext } = await import(
				"@tanstack/start-storage-context"
			);
			try {
				await auth.api.updateMemberRole({
					body: {
						memberId: data.memberId,
						role: data.role,
						organizationId: org.id,
					},
					headers: getStartContext().request.headers,
				});
				return { ok: true };
			} catch (err) {
				return {
					ok: false,
					error:
						err instanceof Error
							? err.message
							: "Could not change this member's role. Try again.",
				};
			}
		},
	);

/** Remove a member (admin). No self-kick — leave is the door out. */
export const removeOrgMember = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("members:manage"),
	])
	.inputValidator((input: { org: string; memberId: string }) => input)
	.handler(
		async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
			const org = (context as { org: OrgWithRole }).org;
			const { requireSession } = await import("#/lib/server/session");
			const userId = await requireSession();
			const { getDb } = await import("#/lib/server/db");
			const { schema } = await import("@tripwire/db");
			const { eq } = await import("drizzle-orm");
			const target = await getDb()
				.db.select({ userId: schema.member.userId })
				.from(schema.member)
				.where(eq(schema.member.id, data.memberId))
				.limit(1);
			if (userId && target[0]?.userId === userId) {
				// §5: no self-kick. Leaving is a deliberate separate action.
				return {
					ok: false,
					error: "You cannot remove yourself. Leave the org instead.",
				};
			}
			const { getAuth } = await import("#/lib/server/auth");
			const auth = getAuth();
			if (!auth) {
				return {
					ok: false,
					error:
						"Sign-in is off in open-dev mode, so this action is not available.",
				};
			}
			const { getStartContext } = await import(
				"@tanstack/start-storage-context"
			);
			try {
				await auth.api.removeMember({
					body: { memberIdOrEmail: data.memberId, organizationId: org.id },
					headers: getStartContext().request.headers,
				});
				return { ok: true };
			} catch (err) {
				return {
					ok: false,
					error:
						err instanceof Error
							? err.message
							: "Could not remove this member. Try again.",
				};
			}
		},
	);

export interface OrgRoleView {
	id: string;
	name: string;
	scopes: OrgScopeLevels;
	memberCount: number;
}

export const listOrgRoles = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("members:read")])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<OrgRoleView[]> => {
		const org = (context as OrgContext).org;
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		const { parseRoleStatements } = await import("@tripwire/auth/org-access");
		const db = getDb().db;
		const rows = await orgServices.listOrgRoles(db, org.id);
		return await Promise.all(
			rows.map(async (row) => {
				const statements = parseRoleStatements(row.permission);
				return {
					id: row.id,
					name: row.role,
					scopes: statements ? statementsToScopes(statements) : {},
					memberCount: await orgServices.countMembersWithRole(
						db,
						org.id,
						row.role,
					),
				};
			}),
		);
	});

type RoleWriteResult = { ok: true } | { ok: false; error: string };

async function callRoleEndpoint(
	run: (auth: Auth, headers: Headers) => Promise<unknown>,
	fallback: string,
): Promise<RoleWriteResult> {
	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	if (!auth) {
		return {
			ok: false,
			error:
				"Sign-in is off in open-dev mode, so this action is not available.",
		};
	}
	const { getStartContext } = await import("@tanstack/start-storage-context");
	try {
		await run(auth, getStartContext().request.headers);
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : fallback };
	}
}

export const createOrgRole = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("members:manage"),
	])
	.inputValidator(
		(input: { org: string; name: string; scopes: OrgRoleScopes }) => ({
			org: input.org,
			...orgRoleInputSchema.parse(input),
		}),
	)
	.handler(async ({ data, context }): Promise<RoleWriteResult> => {
		const org = (context as OrgContext).org;
		return await callRoleEndpoint(
			(auth, headers) =>
				auth.api.createOrgRole({
					body: {
						organizationId: org.id,
						role: data.name,
						permission: scopesToStatements(data.scopes),
					},
					headers,
				}),
			"Could not create the role. Try again.",
		);
	});

export const updateOrgRole = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("members:manage"),
	])
	.inputValidator(
		(input: { org: string; name: string; scopes: OrgRoleScopes }) => ({
			org: input.org,
			...orgRoleInputSchema.parse(input),
		}),
	)
	.handler(async ({ data, context }): Promise<RoleWriteResult> => {
		const org = (context as OrgContext).org;
		return await callRoleEndpoint(
			(auth, headers) =>
				auth.api.updateOrgRole({
					body: {
						organizationId: org.id,
						roleName: data.name,
						data: { permission: scopesToStatements(data.scopes) },
					},
					headers,
				}),
			"Could not save the role. Try again.",
		);
	});

export const deleteOrgRole = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("members:manage"),
	])
	.inputValidator((input: { org: string; name: string }) => ({
		org: input.org,
		name: customOrgRoleNameSchema.parse(input.name),
	}))
	.handler(async ({ data, context }): Promise<RoleWriteResult> => {
		const org = (context as OrgContext).org;
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		const holders = await orgServices.countMembersWithRole(
			getDb().db,
			org.id,
			data.name,
		);
		if (holders > 0) {
			return {
				ok: false,
				error: "Give the members who hold this role another role first.",
			};
		}
		return await callRoleEndpoint(
			(auth, headers) =>
				auth.api.deleteOrgRole({
					body: { organizationId: org.id, roleName: data.name },
					headers,
				}),
			"Could not delete the role. Try again.",
		);
	});

/** Leave an org (member). The plugin guards the last admin; hooks guard personal. */
export const leaveOrg = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<{ ok: boolean; error?: string }> => {
		const org = (context as { org: OrgWithRole }).org;
		if (org.isPersonal) {
			return { ok: false, error: "You cannot leave your personal org." };
		}
		const { getAuth } = await import("#/lib/server/auth");
		const auth = getAuth();
		if (!auth) {
			return {
				ok: false,
				error:
					"Sign-in is off in open-dev mode, so this action is not available.",
			};
		}
		const { getStartContext } = await import("@tanstack/start-storage-context");
		try {
			await auth.api.leaveOrganization({
				body: { organizationId: org.id },
				headers: getStartContext().request.headers,
			});
			return { ok: true };
		} catch (err) {
			return {
				ok: false,
				error:
					err instanceof Error
						? err.message
						: "Could not leave the org. If you are its last admin, make another member an admin first.",
			};
		}
	});

// ── invite links (§6) ───────────────────────────────────────────────────

export const createOrgInvite = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("members:manage"),
	])
	.inputValidator((input: { org: string } & CreateInviteInput) => input)
	.handler(
		async ({ data, context }): Promise<{ token?: string; error?: string }> => {
			const org = (context as { org: OrgWithRole }).org;
			const { requireSession } = await import("#/lib/server/session");
			const userId = await requireSession();
			if (!userId) {
				return { error: "Sign in to create invites." };
			}
			const { getDb } = await import("#/lib/server/db");
			const { orgServices } = await import("@tripwire/db");
			try {
				const { token } = await orgServices.createInviteLink(getDb().db, {
					orgId: org.id,
					role: data.role,
					createdBy: userId,
					maxUses: data.maxUses,
					expiresInDays: data.expiresInDays,
				});
				return { token };
			} catch (err) {
				return {
					error:
						err instanceof Error
							? err.message
							: "Could not create the invite link. Try again.",
				};
			}
		},
	);

export const listOrgInvites = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("members:manage"),
	])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<InviteLinkView[]> => {
		const org = (context as { org: OrgWithRole }).org;
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		return await orgServices.listInviteLinks(getDb().db, org.id);
	});

export const revokeOrgInvite = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("members:manage"),
	])
	.inputValidator((input: { org: string; inviteId: string }) => input)
	.handler(async ({ data, context }): Promise<{ revoked: boolean }> => {
		const org = (context as { org: OrgWithRole }).org;
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		return await orgServices.revokeInviteLink(getDb().db, {
			orgId: org.id,
			inviteId: data.inviteId,
		});
	});

/**
 * Redeem an invite link. DELIBERATELY not behind the access gate: a pending
 * user redeeming an approved admin's invite is exactly how they BECOME
 * approved (§6) — gating this on approval would deadlock the flow. Session
 * required; everything else (expiry, uses, revocation, idempotency, the
 * inviter-status rule) is enforced in the transactional service.
 */
export const redeemOrgInvite = createServerFn({ method: "POST" })
	.inputValidator((input: { token: string }) => input)
	.handler(
		async ({ data }): Promise<RedeemResult | { status: "unauthenticated" }> => {
			const { requireSession } = await import("#/lib/server/session");
			const userId = await requireSession();
			if (!userId) {
				return { status: "unauthenticated" };
			}
			const { getDb } = await import("#/lib/server/db");
			const { orgServices } = await import("@tripwire/db");
			return await orgServices.redeemInviteLink(getDb().db, {
				token: data.token,
				userId,
			});
		},
	);

// ── URL resolution + org analytics (§8) ─────────────────────────────────

/** /:org/:repo layout resolve — RepoLite or the 404 the route renders. */
export const getOrgRepoContext = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgMemberMiddleware])
	.inputValidator((input: { org: string; repo: string }) => input)
	.handler(async ({ data, context }) => {
		const org = (context as { org: OrgWithRole }).org;
		const { resolveOrgRepo } = await import("#/lib/server/org-guard");
		return await resolveOrgRepo(org.id, data.repo);
	});

export interface OrgAnalyticsSummary {
	repos: number;
	armedRepos: number;
	events24h: number;
	blocked24h: number;
	pendingModeration: number;
	/** 24h hourly counts (oldest→newest) for the two flow metrics that have a
	 * real trend. Totals (repos/armed) + current depth (awaiting) have none. */
	eventsSeries: number[];
	blockedSeries: number[];
}

/**
 * /:org/analytics — THIN aggregate counts across the org's repos (§8: no new
 * analytics infrastructure; per-repo depth lives at /:org/:repo/analytics).
 */
export const getOrgAnalyticsSummary = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("analytics:read"),
	])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<OrgAnalyticsSummary> => {
		const org = (context as { org: OrgWithRole }).org;
		const { getDb } = await import("#/lib/server/db");
		const { sql } = await import("drizzle-orm");
		const db = getDb().db;
		const result = await db.execute(sql`
			WITH org_repos AS (
				SELECT id, forge, full_name, armed FROM repos
				WHERE org_id = ${org.id} AND removed_at IS NULL
			),
			hours AS (SELECT generate_series(0, 23) AS h)
			SELECT
				(SELECT count(*) FROM org_repos)::int AS repos,
				(SELECT count(*) FROM org_repos WHERE armed)::int AS "armedRepos",
				(SELECT count(*) FROM events e JOIN org_repos r ON r.forge = e.forge AND r.full_name = e.repo_full_name
				  WHERE e.received_at > now() - interval '24 hours')::int AS "events24h",
				(SELECT count(*) FROM runs run JOIN events e ON e.id = run.event_id JOIN org_repos r ON r.forge = e.forge AND r.full_name = run.repo_full_name
				  WHERE run.verdict IN ('block', 'changes_required', 'close') AND run.created_at > now() - interval '24 hours')::int AS "blocked24h",
				(SELECT count(*) FROM moderation_items mi JOIN runs run ON run.id = mi.run_id
				  JOIN events e ON e.id = run.event_id JOIN org_repos r ON r.forge = e.forge AND r.full_name = run.repo_full_name
				  WHERE mi.status = 'pending')::int AS "pendingModeration",
				(SELECT array_agg(COALESCE(ev.n, 0) ORDER BY hours.h DESC)
				  FROM hours LEFT JOIN (
				    SELECT floor(extract(epoch FROM now() - e.received_at) / 3600)::int AS ha,
				           count(*)::int AS n
				    FROM events e JOIN org_repos r ON r.forge = e.forge AND r.full_name = e.repo_full_name
				    WHERE e.received_at > now() - interval '24 hours'
				    GROUP BY 1
				  ) ev ON ev.ha = hours.h) AS "eventsSeries",
				(SELECT array_agg(COALESCE(bl.n, 0) ORDER BY hours.h DESC)
				  FROM hours LEFT JOIN (
				    SELECT floor(extract(epoch FROM now() - run.created_at) / 3600)::int AS ha,
				           count(*)::int AS n
				    FROM runs run JOIN events e ON e.id = run.event_id JOIN org_repos r ON r.forge = e.forge AND r.full_name = run.repo_full_name
				    WHERE run.verdict IN ('block', 'changes_required', 'close') AND run.created_at > now() - interval '24 hours'
				    GROUP BY 1
				  ) bl ON bl.ha = hours.h) AS "blockedSeries"
		`);
		const row = result.rows[0] as
			| {
					repos: number;
					armedRepos: number;
					events24h: number;
					blocked24h: number;
					pendingModeration: number;
					eventsSeries: number[] | null;
					blockedSeries: number[] | null;
			  }
			| undefined;
		return {
			repos: row?.repos ?? 0,
			armedRepos: row?.armedRepos ?? 0,
			events24h: row?.events24h ?? 0,
			blocked24h: row?.blocked24h ?? 0,
			pendingModeration: row?.pendingModeration ?? 0,
			eventsSeries: row?.eventsSeries ?? [],
			blockedSeries: row?.blockedSeries ?? [],
		};
	});
