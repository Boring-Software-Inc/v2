import { createHash, randomBytes } from "node:crypto";
import type { ForgeId } from "@tripwire/contracts";
import {
	type Forge,
	forgeSchema,
	INSTALL_ACCESS_CHECK_TTL_SECONDS,
	type InstallStatus,
	type OrgRole,
	orgSlugSchema,
	slugifyOrgName,
	suffixSlug,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import {
	and,
	eq,
	gt,
	inArray,
	isNull,
	lt,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../client.ts";
import { user } from "../schema/auth.ts";
import {
	member,
	organization,
	organizationInstallations,
	organizationInviteLinks,
	organizationRole,
} from "../schema/organizations.ts";
import { repos, ruleConfigs, workflowDefinitions } from "../schema/repos.ts";
import { promoteUserAccess } from "./access.ts";
import { getFreshInstallAccessCheck } from "./installation-access.ts";
import { runBearsVerdict } from "./runs.ts";

/**
 * Organization services (§org-model). Better Auth's plugin owns the
 * org/member CRUD that flows through its endpoints (team-org creation,
 * role updates, removal, leave) — with our hooks guarding the invariants.
 * THIS module owns everything the plugin doesn't model: personal orgs,
 * invite LINKS, installations, the cascade-enumerated delete, and the
 * membership reads the role gate and routing resolve against.
 */

// ── slugs ───────────────────────────────────────────────────────────────

/**
 * Pick a free, valid slug for a display name: slugify, then walk numeric
 * suffixes past reserved words and collisions. Bounded — the suffix walk
 * cannot loop forever.
 */
export async function pickOrgSlug(db: Db, name: string): Promise<string> {
	const base = slugifyOrgName(name);
	for (let n = 0; n < 100; n++) {
		const candidate = n === 0 ? base : suffixSlug(base, n + 1);
		if (!orgSlugSchema.safeParse(candidate).success) {
			continue; // reserved or malformed — try the next suffix
		}
		const taken = await db
			.select({ id: organization.id })
			.from(organization)
			.where(eq(organization.slug, candidate))
			.limit(1);
		if (taken.length === 0) {
			return candidate;
		}
	}
	// Pathological collision storm — fall back to an id-derived slug.
	return `org-${generateId().slice(0, 12)}`;
}

// ── orgs + membership reads ─────────────────────────────────────────────

export interface OrgSummary {
	id: string;
	slug: string;
	name: string;
	isPersonal: boolean;
	avatarHue: number | null;
	timezone: string | null;
}

export interface OrgWithRole extends OrgSummary {
	role: string;
}

/**
 * Resolve a slug for a caller — the routing 404 boundary. Returns null when
 * the org doesn't exist OR the caller isn't a member: a non-member must not
 * be able to distinguish the two (§8: 404, never 403).
 */
export async function getOrgForUser(
	db: Db,
	input: { slug: string; userId: string },
): Promise<OrgWithRole | null> {
	const rows = await db
		.select({
			id: organization.id,
			slug: organization.slug,
			name: organization.name,
			isPersonal: organization.isPersonal,
			avatarHue: organization.avatarHue,
			timezone: organization.timezone,
			role: member.role,
		})
		.from(organization)
		.innerJoin(member, eq(member.organizationId, organization.id))
		.where(
			and(eq(organization.slug, input.slug), eq(member.userId, input.userId)),
		)
		.limit(1);
	const row = rows[0];
	return row ?? null;
}

/** Every org the user belongs to — the switcher list. Personal org first. */
export async function listUserOrgs(
	db: Db,
	userId: string,
): Promise<OrgWithRole[]> {
	const rows = await db
		.select({
			id: organization.id,
			slug: organization.slug,
			name: organization.name,
			isPersonal: organization.isPersonal,
			avatarHue: organization.avatarHue,
			timezone: organization.timezone,
			role: member.role,
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, userId))
		.orderBy(sql`${organization.isPersonal} DESC, ${organization.name}`);
	return rows;
}

/** The caller's role in an org, fresh from the DB (never from session). */
export async function getMemberRole(
	db: Db,
	input: { orgId: string; userId: string },
): Promise<string | null> {
	const rows = await db
		.select({ role: member.role })
		.from(member)
		.where(
			and(
				eq(member.organizationId, input.orgId),
				eq(member.userId, input.userId),
			),
		)
		.limit(1);
	return rows[0]?.role ?? null;
}

export interface OrgRoleRow {
	id: string;
	role: string;
	permission: string;
	createdAt: Date;
}

export async function listOrgRoles(
	db: Db,
	orgId: string,
): Promise<OrgRoleRow[]> {
	return await db
		.select({
			id: organizationRole.id,
			role: organizationRole.role,
			permission: organizationRole.permission,
			createdAt: organizationRole.createdAt,
		})
		.from(organizationRole)
		.where(eq(organizationRole.organizationId, orgId))
		.orderBy(organizationRole.role);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

export async function getOrgRoles(
	db: Executor,
	orgId: string,
	names: readonly string[],
): Promise<OrgRoleRow[]> {
	if (names.length === 0) {
		return [];
	}
	return await db
		.select({
			id: organizationRole.id,
			role: organizationRole.role,
			permission: organizationRole.permission,
			createdAt: organizationRole.createdAt,
		})
		.from(organizationRole)
		.where(
			and(
				eq(organizationRole.organizationId, orgId),
				inArray(organizationRole.role, [...names]),
			),
		);
}

export async function countMembersWithRole(
	db: Db,
	orgId: string,
	role: string,
): Promise<number> {
	const rows = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(member)
		.where(
			and(
				eq(member.organizationId, orgId),
				sql`${role} = ANY(string_to_array(replace(${member.role}, ' ', ''), ','))`,
			),
		);
	return rows[0]?.n ?? 0;
}

export async function countAdmins(
	db: Executor,
	orgId: string,
): Promise<number> {
	const rows = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.role, "admin")));
	return rows[0]?.n ?? 0;
}

/**
 * THE role-change invariants, extracted so every path shares one guard:
 * the Better Auth plugin hook (`beforeUpdateMemberRole`) and the staff
 * portal's `updateMemberRoleForStaff`. Personal orgs refuse, two roles only,
 * and a demotion may not remove the last admin. Throws the same messages the
 * hook always threw; callers surface them as-is.
 */
export async function assertRoleChangeAllowed(
	db: Executor,
	input: {
		orgId: string;
		isPersonal: boolean;
		currentRole: string;
		newRole: string;
	},
): Promise<void> {
	if (input.isPersonal) {
		throw new Error("cannot change roles in a personal org");
	}
	if (input.newRole.includes(",")) {
		throw new Error("a member holds one role");
	}
	if (input.newRole !== "admin" && input.newRole !== "member") {
		const [custom] = await getOrgRoles(db, input.orgId, [input.newRole]);
		if (!custom) {
			throw new Error("unknown role");
		}
	}
	if (
		input.currentRole.split(",").includes("admin") &&
		input.newRole !== "admin"
	) {
		const admins = await countAdmins(db, input.orgId);
		if (admins <= 1) {
			throw new Error("an org must keep at least one admin");
		}
	}
}

/**
 * Staff-portal role change. The plugin's update-member-role endpoint refuses
 * callers who are not org members, so platform staff cannot route through it —
 * this is the sanctioned alternative: the SAME guard (`assertRoleChangeAllowed`,
 * shared with the plugin hook), then the one-column update. The portal gets no
 * bypass powers over org invariants.
 */
export async function updateMemberRoleForStaff(
	db: Db,
	input: { memberId: string; role: OrgRole },
): Promise<{ ok: true } | { ok: false; error: string }> {
	return await db.transaction(async (tx) => {
		const rows = await tx
			.select({
				orgId: member.organizationId,
				currentRole: member.role,
				isPersonal: organization.isPersonal,
			})
			.from(member)
			.innerJoin(organization, eq(organization.id, member.organizationId))
			.where(eq(member.id, input.memberId))
			.limit(1)
			.for("update", { of: organization });
		const row = rows[0];
		if (!row) {
			return { ok: false, error: "member not found" };
		}
		try {
			await assertRoleChangeAllowed(tx, {
				orgId: row.orgId,
				isPersonal: row.isPersonal,
				currentRole: row.currentRole,
				newRole: input.role,
			});
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : "role change refused",
			};
		}
		await tx
			.update(member)
			.set({ role: input.role })
			.where(eq(member.id, input.memberId));
		return { ok: true };
	});
}

/**
 * Idempotently ensure the user's personal org (§1). Called from the Better
 * Auth user-create hook AND the migration backfill — safe to re-run. Personal
 * orgs bypass the plugin entirely (direct inserts), so the plugin hooks can
 * refuse ALL member/invite mutations on personal orgs unconditionally.
 *
 * Slug source: the user's display name — for GitHub sign-ins that's the
 * closest thing to the login the system holds at create time (the identity
 * mirror also falls back to it).
 */
export async function ensurePersonalOrg(
	db: Db,
	input: { userId: string; name: string },
): Promise<OrgSummary> {
	const existing = await db
		.select({
			id: organization.id,
			slug: organization.slug,
			name: organization.name,
			isPersonal: organization.isPersonal,
			avatarHue: organization.avatarHue,
			timezone: organization.timezone,
		})
		.from(organization)
		.innerJoin(member, eq(member.organizationId, organization.id))
		.where(
			and(eq(member.userId, input.userId), eq(organization.isPersonal, true)),
		)
		.limit(1);
	if (existing[0]) {
		return existing[0];
	}
	const slug = await pickOrgSlug(db, input.name);
	const org = {
		id: generateId(),
		name: input.name,
		slug,
		isPersonal: true,
		avatarHue: null,
		timezone: null,
	};
	await db.insert(organization).values(org);
	await db.insert(member).values({
		id: generateId(),
		organizationId: org.id,
		userId: input.userId,
		role: "admin",
	});
	return org;
}

// ── invite links (§6) ───────────────────────────────────────────────────

function hashInviteToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export interface InviteLinkView {
	id: string;
	role: OrgRole;
	expiresAt: Date;
	maxUses: number;
	uses: number;
	revokedAt: Date | null;
	createdBy: string;
	createdAt: Date;
}

/**
 * Mint an invite link. The RAW token is returned exactly once (the caller
 * builds `/invite/<token>`); only its sha-256 lands in the DB, so a leaked
 * table cannot mint memberships. Personal orgs refuse (§1).
 */
export async function createInviteLink(
	db: Db,
	input: {
		orgId: string;
		role: OrgRole;
		createdBy: string;
		maxUses?: number;
		expiresInDays?: number;
	},
): Promise<{ token: string; id: string }> {
	const orgRows = await db
		.select({ isPersonal: organization.isPersonal })
		.from(organization)
		.where(eq(organization.id, input.orgId))
		.limit(1);
	if (!orgRows[0]) {
		throw new Error("organization not found");
	}
	if (orgRows[0].isPersonal) {
		throw new Error("personal orgs cannot create invite links");
	}
	const token = randomBytes(32).toString("base64url");
	const id = generateId();
	const days = input.expiresInDays ?? 7;
	await db.insert(organizationInviteLinks).values({
		id,
		organizationId: input.orgId,
		tokenHash: hashInviteToken(token),
		role: input.role,
		expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
		maxUses: input.maxUses ?? 1,
		createdBy: input.createdBy,
	});
	return { token, id };
}

export async function listInviteLinks(
	db: Db,
	orgId: string,
): Promise<InviteLinkView[]> {
	const rows = await db
		.select({
			id: organizationInviteLinks.id,
			role: organizationInviteLinks.role,
			expiresAt: organizationInviteLinks.expiresAt,
			maxUses: organizationInviteLinks.maxUses,
			uses: organizationInviteLinks.uses,
			revokedAt: organizationInviteLinks.revokedAt,
			createdBy: organizationInviteLinks.createdBy,
			createdAt: organizationInviteLinks.createdAt,
		})
		.from(organizationInviteLinks)
		.where(eq(organizationInviteLinks.organizationId, orgId))
		.orderBy(sql`${organizationInviteLinks.createdAt} DESC`);
	return rows.map((r) => ({ ...r, role: r.role as OrgRole }));
}

export async function revokeInviteLink(
	db: Db,
	input: { orgId: string; inviteId: string },
): Promise<{ revoked: boolean }> {
	const rows = await db
		.update(organizationInviteLinks)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(organizationInviteLinks.id, input.inviteId),
				eq(organizationInviteLinks.organizationId, input.orgId),
				isNull(organizationInviteLinks.revokedAt),
			),
		)
		.returning({ id: organizationInviteLinks.id });
	return { revoked: rows.length > 0 };
}

export type RedeemResult =
	| { status: "joined"; orgSlug: string; role: OrgRole; approved: boolean }
	| { status: "already-member"; orgSlug: string }
	| {
			status: "invalid";
			reason: "not-found" | "revoked" | "expired" | "exhausted";
	  };

/**
 * Redeem an invite link — ONE transaction, concurrency-safe (§6 + amendment 2).
 *
 * Ordering inside the tx:
 *   1. lock the link row (SELECT … FOR UPDATE) — serializes racing redeems;
 *   2. validate revoked/expired/exhausted against the locked row;
 *   3. membership insert with ON CONFLICT DO NOTHING — an existing member is
 *      a FULL no-op: role untouched, and the use is NOT consumed (a curious
 *      teammate clicking the link must not burn one of its N uses);
 *   4. guarded increment `SET uses = uses + 1 WHERE uses < max_uses` — the
 *      belt-and-braces under the row lock; a zero row-count aborts the tx so
 *      the membership insert unwinds with it. Two simultaneous redemptions of
 *      a maxUses:1 link ⇒ exactly one wins.
 *
 * Beta approval (amendment 1 + the inviter-status rule): the redeemer is
 * promoted through `promoteUserAccess` — the ONE promotion path — iff the
 * link creator's accessStatus is "approved" read fresh AT REDEMPTION TIME.
 * There is no org-level approval concept. An unapproved creator's link still
 * grants membership; the redeemer stays pending (lands in /queue).
 */
export async function redeemInviteLink(
	db: Db,
	input: { token: string; userId: string },
): Promise<RedeemResult> {
	const tokenHash = hashInviteToken(input.token);
	return await db
		.transaction(async (tx): Promise<RedeemResult> => {
			const linkRows = await tx.execute(sql`
			SELECT l.id, l.organization_id AS "orgId", l.role, l.expires_at AS "expiresAt",
			       l.max_uses AS "maxUses", l.uses, l.revoked_at AS "revokedAt",
			       l.created_by AS "createdBy", o.slug AS "orgSlug"
			FROM organization_invite_links l
			JOIN organization o ON o.id = l.organization_id
			WHERE l.token_hash = ${tokenHash}
			FOR UPDATE OF l
		`);
			const link = linkRows.rows[0] as
				| {
						id: string;
						orgId: string;
						role: string;
						expiresAt: Date;
						maxUses: number;
						uses: number;
						revokedAt: Date | null;
						createdBy: string;
						orgSlug: string;
				  }
				| undefined;
			if (!link) {
				return { status: "invalid", reason: "not-found" };
			}
			if (link.revokedAt) {
				return { status: "invalid", reason: "revoked" };
			}
			if (new Date(link.expiresAt).getTime() <= Date.now()) {
				return { status: "invalid", reason: "expired" };
			}
			if (link.uses >= link.maxUses) {
				return { status: "invalid", reason: "exhausted" };
			}

			// Existing member ⇒ full no-op: role untouched, use NOT consumed.
			const inserted = await tx
				.insert(member)
				.values({
					id: generateId(),
					organizationId: link.orgId,
					userId: input.userId,
					role: link.role,
				})
				.onConflictDoNothing({
					target: [member.organizationId, member.userId],
				})
				.returning({ id: member.id });
			if (inserted.length === 0) {
				return { status: "already-member", orgSlug: link.orgSlug };
			}

			const consumed = await tx
				.update(organizationInviteLinks)
				.set({ uses: sql`${organizationInviteLinks.uses} + 1` })
				.where(
					and(
						eq(organizationInviteLinks.id, link.id),
						lt(organizationInviteLinks.uses, organizationInviteLinks.maxUses),
						isNull(organizationInviteLinks.revokedAt),
						gt(organizationInviteLinks.expiresAt, new Date()),
					),
				)
				.returning({ id: organizationInviteLinks.id });
			if (consumed.length === 0) {
				// Lost the race after all — unwind the membership with the tx.
				throw new InviteExhaustedError();
			}

			// Inviter-status-at-redemption rule — fresh read, single promotion path.
			const creatorRows = await tx
				.select({ accessStatus: user.accessStatus })
				.from(user)
				.where(eq(user.id, link.createdBy))
				.limit(1);
			let approved = false;
			if (creatorRows[0]?.accessStatus === "approved") {
				await promoteUserAccess(tx, {
					userId: input.userId,
					reviewedBy: link.createdBy,
				});
				approved = true;
			}

			return {
				status: "joined",
				orgSlug: link.orgSlug,
				role: link.role as OrgRole,
				approved,
			};
		})
		.catch((err): RedeemResult => {
			if (err instanceof InviteExhaustedError) {
				return { status: "invalid", reason: "exhausted" };
			}
			throw err;
		});
}

class InviteExhaustedError extends Error {
	constructor() {
		super("invite link exhausted");
	}
}

// ── installations (§2/§3/§10) ───────────────────────────────────────────

/**
 * Claim an installation for an ORG. Idempotent; `(forge, installationId)`
 * unique means a second org cannot steal a claimed installation — the insert
 * no-ops and `claimed` reports whether THIS org owns it. On claim, repos of
 * the installation get `org_id` backfilled (the denormalized scope hop).
 */
export async function linkOrgInstallation(
	db: Db,
	input: {
		orgId: string;
		installationId: string;
		forge?: Forge;
		accountType?: string;
		accountLogin?: string;
	},
): Promise<{ claimed: boolean }> {
	const forge = input.forge ?? "github";
	if (forge === "gitcafe") return { claimed: false };
	await db
		.insert(organizationInstallations)
		.values({
			id: generateId(),
			organizationId: input.orgId,
			forge,
			installationId: input.installationId,
			accountType: input.accountType,
			accountLogin: input.accountLogin,
		})
		.onConflictDoNothing({
			target: [
				organizationInstallations.forge,
				organizationInstallations.installationId,
			],
		});
	const owner = await db
		.select({ organizationId: organizationInstallations.organizationId })
		.from(organizationInstallations)
		.where(
			and(
				eq(organizationInstallations.forge, forge),
				eq(organizationInstallations.installationId, input.installationId),
			),
		)
		.limit(1);
	const claimed = owner[0]?.organizationId === input.orgId;
	if (claimed) {
		await db
			.update(repos)
			.set({ orgId: input.orgId })
			.where(
				and(
					eq(repos.forge, forge),
					eq(repos.installationId, input.installationId),
				),
			);
	}
	return { claimed };
}

/**
 * Record webhook-observed account metadata on an already-claimed installation.
 * Never creates a claim — an unclaimed GitHub-side install stays unclaimed
 * until a human binds it on the claim screen (§10: never auto-attach).
 */
export async function recordInstallationAccount(
	db: Db,
	input: {
		installationId: string;
		forge?: Forge;
		accountType?: string;
		accountLogin?: string;
	},
): Promise<void> {
	if (!input.accountType && !input.accountLogin) {
		return;
	}
	await db
		.update(organizationInstallations)
		.set({
			...(input.accountType ? { accountType: input.accountType } : {}),
			...(input.accountLogin ? { accountLogin: input.accountLogin } : {}),
		})
		.where(
			and(
				eq(organizationInstallations.forge, input.forge ?? "github"),
				eq(organizationInstallations.installationId, input.installationId),
			),
		);
}

/**
 * Admin-callable "move installation between orgs" (§11). History moves with
 * it for free: events/runs key on repoFullName and repo rows keep their ids —
 * only the org pointer changes. Idempotent: moving to the current org no-ops.
 */
export async function moveInstallation(
	db: Db,
	input: { installationId: string; toOrgId: string; forge?: Forge },
): Promise<{ moved: boolean }> {
	const forge = input.forge ?? "github";
	if (forge === "gitcafe") return { moved: false };
	return await db.transaction(async (tx) => {
		const updated = await tx
			.update(organizationInstallations)
			.set({ organizationId: input.toOrgId })
			.where(
				and(
					eq(organizationInstallations.forge, forge),
					eq(organizationInstallations.installationId, input.installationId),
				),
			)
			.returning({ id: organizationInstallations.id });
		if (updated.length === 0) {
			return { moved: false };
		}
		await tx
			.update(repos)
			.set({ orgId: input.toOrgId })
			.where(
				and(
					eq(repos.forge, forge),
					eq(repos.installationId, input.installationId),
				),
			);
		return { moved: true };
	});
}

/** The org that owns an installation — the webhook ingest resolution hop. */
export async function getInstallationOrg(
	db: Db,
	input: { installationId: string; forge?: Forge },
): Promise<string | null> {
	const rows = await db
		.select({ organizationId: organizationInstallations.organizationId })
		.from(organizationInstallations)
		.where(
			and(
				eq(organizationInstallations.forge, input.forge ?? "github"),
				eq(organizationInstallations.installationId, input.installationId),
			),
		)
		.limit(1);
	return rows[0]?.organizationId ?? null;
}

const approvedInstallRequestSchema = z.object({
	installationId: z.string(),
	account: z.string(),
	repoCount: z.number(),
});

export type ApprovedInstallRequest = z.infer<
	typeof approvedInstallRequestSchema
>;

export async function listApprovedInstallRequests(
	db: Db,
	input: { userId: string },
): Promise<ApprovedInstallRequest[]> {
	const result = await db.execute(sql`
		SELECT e.raw->'installation'->>'id' AS "installationId",
		       e.raw->'installation'->'account'->>'login' AS account,
		       count(DISTINCT r.id)::int AS "repoCount"
		FROM events e
		JOIN account a
		  ON a.provider_id = 'github'
		 AND a.user_id = ${input.userId}
		 AND a.account_id = e.raw->'requester'->>'id'
		JOIN repos r
		  ON r.forge = 'github'
		 AND r.installation_id = e.raw->'installation'->>'id'
		 AND r.removed_at IS NULL
		LEFT JOIN organization_installations oi
		  ON oi.forge = 'github'
		 AND oi.installation_id = e.raw->'installation'->>'id'
		WHERE e.forge = 'github'
		  AND e.kind = 'installation.created'
		  AND oi.id IS NULL
		GROUP BY 1, 2
		ORDER BY max(e.received_at) DESC
	`);
	return z.array(approvedInstallRequestSchema).parse(result.rows);
}

function installationOwnedBy(
	userId: SQL,
	forge: SQL,
	installationId: SQL,
	options: { anyAge?: boolean } = {},
): SQL {
	const fresh = options.anyAge
		? sql``
		: sql`AND c.verified_at > now() - make_interval(secs => ${INSTALL_ACCESS_CHECK_TTL_SECONDS})`;
	return sql`(
		(${forge} = 'github' AND EXISTS (
			SELECT 1
			FROM events e
			JOIN account a
			  ON a.provider_id = 'github'
			 AND a.user_id = ${userId}
			 AND a.account_id IN (
			       e.raw->'sender'->>'id',
			       e.raw->'requester'->>'id',
			       e.raw->'installation'->'account'->>'id'
			     )
			WHERE e.forge = 'github'
			  AND e.kind = 'installation.created'
			  AND e.raw->'installation'->>'id' = ${installationId}
		))
		OR (${forge} = 'github' AND EXISTS (
			SELECT 1
			FROM installation_access_checks c
			WHERE c.user_id = ${userId}
			  AND c.forge = 'github'
			  AND c.installation_id = ${installationId}
			  AND c.result = 'granted-admin'
			  ${fresh}
		))
	)`;
}

export async function userCanClaimInstallation(
	db: Db,
	input: { userId: string; forge: Forge; installationId: string },
): Promise<boolean> {
	const result = await db.execute(sql`
		SELECT 1 AS owned
		WHERE ${installationOwnedBy(
			sql`${input.userId}`,
			sql`${input.forge}`,
			sql`${input.installationId}`,
		)}
	`);
	return result.rows.length > 0;
}

const unprovenInstallationClaimSchema = z.object({
	installationId: z.string(),
	orgId: z.string(),
	orgSlug: z.string(),
	account: z.string().nullable(),
});

export type UnprovenInstallationClaim = z.infer<
	typeof unprovenInstallationClaimSchema
>;

export async function listUnprovenInstallationClaims(
	db: Db,
): Promise<UnprovenInstallationClaim[]> {
	const result = await db.execute(sql`
		SELECT oi.installation_id AS "installationId",
		       o.id AS "orgId",
		       o.slug AS "orgSlug",
		       oi.account_login AS account
		FROM organization_installations oi
		JOIN organization o ON o.id = oi.organization_id
		WHERE oi.forge = 'github'
		  AND oi.installation_id ~ '^[0-9]+$'
		  AND NOT EXISTS (
		    SELECT 1
		    FROM member m
		    WHERE m.organization_id = oi.organization_id
		      AND 'admin' = ANY(string_to_array(m.role, ','))
		      AND ${installationOwnedBy(
						sql`m.user_id`,
						sql`oi.forge`,
						sql`oi.installation_id`,
						{ anyAge: true },
					)}
		  )
		ORDER BY oi.installation_id
	`);
	return z.array(unprovenInstallationClaimSchema).parse(result.rows);
}

const claimableInstallationSchema = z.object({
	installationId: z.string(),
	forge: forgeSchema,
	account: z.string().nullable(),
	repoCount: z.number(),
});

export type ClaimableInstallation = z.infer<typeof claimableInstallationSchema>;

export async function listClaimableInstallations(
	db: Db,
	input: { userId: string; forge?: Forge },
): Promise<ClaimableInstallation[]> {
	const result = await db.execute(sql`
		SELECT r.installation_id AS "installationId",
		       r.forge AS forge,
		       min(r.owner) AS account,
		       count(*)::int AS "repoCount"
		FROM repos r
		LEFT JOIN organization_installations oi
		  ON oi.installation_id = r.installation_id AND oi.forge = r.forge
		WHERE r.installation_id IS NOT NULL
		  ${input.forge ? sql`AND r.forge = ${input.forge}` : sql``}
		  AND r.installation_id <> ''
		  AND r.removed_at IS NULL
		  AND oi.id IS NULL
		  AND ${installationOwnedBy(sql`${input.userId}`, sql`r.forge`, sql`r.installation_id`)}
		GROUP BY r.installation_id, r.forge
		ORDER BY min(r.installed_at) DESC
	`);
	return z.array(claimableInstallationSchema).parse(result.rows);
}

async function orgRef(
	db: Db,
	orgId: string,
): Promise<{ id: string; slug: string; name: string } | null> {
	const rows = await db
		.select({
			id: organization.id,
			slug: organization.slug,
			name: organization.name,
		})
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);
	return rows[0] ?? null;
}

const installEventStateSchema = z.object({
	normalized: z.boolean().nullable(),
	processing: z.boolean().nullable(),
	quarantined: z.boolean().nullable(),
});

async function installEventState(
	db: Db,
	input: { forge: Forge; installationId: string },
): Promise<z.infer<typeof installEventStateSchema>> {
	const result = await db.execute(sql`
		SELECT bool_or(e.kind = 'installation.created') AS normalized,
		       bool_or(e.kind IS NULL AND NOT e.quarantined) AS processing,
		       bool_or(e.quarantined) AS quarantined
		FROM events e
		WHERE e.forge = ${input.forge}
		  AND e.raw_kind = 'installation'
		  AND e.raw->>'action' = 'created'
		  AND e.raw->'installation'->>'id' = ${input.installationId}
	`);
	return installEventStateSchema.parse(result.rows[0]);
}

export async function resolveInstallStatus(
	db: Db,
	input: {
		userId: string | null;
		forge: Forge;
		installationId: string;
		stateOrgId: string | null;
	},
): Promise<InstallStatus> {
	const repoRows = await db
		.select({
			owner: repos.owner,
			forge: repos.forge,
			n: sql<number>`count(*)::int`,
		})
		.from(repos)
		.where(
			and(
				eq(repos.installationId, input.installationId),
				eq(repos.forge, input.forge),
				isNull(repos.removedAt),
			),
		)
		.groupBy(repos.owner, repos.forge);
	const forge = input.forge;
	const base = { installationId: input.installationId, forge };
	const userId = input.userId;
	if (!userId) {
		return { ...base, status: "not-yours", recoverable: false };
	}
	const ownerOrgId = await getInstallationOrg(db, {
		installationId: input.installationId,
		forge,
	});
	if (ownerOrgId) {
		const role = await getMemberRole(db, { orgId: ownerOrgId, userId });
		const owner = role ? await orgRef(db, ownerOrgId) : null;
		return owner
			? { ...base, status: "claimed-by-your-org", orgSlug: owner.slug }
			: { ...base, status: "not-yours", recoverable: false };
	}
	if (forge !== "github") {
		return { ...base, status: "not-yours", recoverable: false };
	}
	const claimable = await userCanClaimInstallation(db, {
		userId,
		forge,
		installationId: input.installationId,
	});
	if (claimable) {
		return {
			...base,
			status: "claimable",
			account: repoRows[0]?.owner ?? null,
			repoCount: repoRows.reduce((sum, row) => sum + row.n, 0),
			stateOrg: input.stateOrgId ? await orgRef(db, input.stateOrgId) : null,
		};
	}
	const check = await getFreshInstallAccessCheck(db, {
		userId,
		forge,
		installationId: input.installationId,
	});
	const result = check?.result ?? null;
	if (result === "pending") {
		return { ...base, status: "recovering" };
	}
	if (result === "not-for-tripwire" || result === "token-expired") {
		return { ...base, status: result };
	}
	if (result === "not-admin") {
		return {
			...base,
			status: "not-admin",
			account: repoRows[0]?.owner ?? null,
		};
	}
	const events = await installEventState(db, {
		forge,
		installationId: input.installationId,
	});
	if (events.normalized) {
		return { ...base, status: "not-yours", recoverable: check === null };
	}
	if (events.processing) {
		return { ...base, status: "processing" };
	}
	if (result === "denied") {
		return { ...base, status: "not-yours", recoverable: false };
	}
	if (events.quarantined) {
		return { ...base, status: "unreadable" };
	}
	return { ...base, status: "missing", recoverable: check === null };
}

// ── deletion (§5) ───────────────────────────────────────────────────────

export interface OrgCascade {
	members: number;
	inviteLinks: number;
	installations: number;
	repos: number;
	ruleConfigs: number;
	workflows: number;
	/**
	 * Event/run history is append-only (§5) and keys on repoFullName — it is
	 * RETAINED, never deleted. Repos are soft-removed (org_id cleared +
	 * removed_at) so history stays interpretable.
	 */
	note: "event history retained; repos soft-removed";
}

/** Enumerate what org deletion touches — shown to the admin before confirm. */
export async function enumerateOrgCascade(
	db: Db,
	orgId: string,
): Promise<OrgCascade> {
	const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
	const orgRepos = db
		.$with("org_repos")
		.as(db.select({ id: repos.id }).from(repos).where(eq(repos.orgId, orgId)));
	const [members, inviteLinks, installations, repoCount] = await Promise.all([
		one(
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(member)
				.where(eq(member.organizationId, orgId)),
		),
		one(
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(organizationInviteLinks)
				.where(eq(organizationInviteLinks.organizationId, orgId)),
		),
		one(
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(organizationInstallations)
				.where(eq(organizationInstallations.organizationId, orgId)),
		),
		one(
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(repos)
				.where(eq(repos.orgId, orgId)),
		),
	]);
	const [rules, workflows] = await Promise.all([
		one(
			db
				.with(orgRepos)
				.select({ n: sql<number>`count(*)::int` })
				.from(ruleConfigs)
				.where(sql`${ruleConfigs.repoId} IN (SELECT id FROM org_repos)`),
		),
		one(
			db
				.with(orgRepos)
				.select({ n: sql<number>`count(*)::int` })
				.from(workflowDefinitions)
				.where(
					sql`${workflowDefinitions.repoId} IN (SELECT id FROM org_repos)`,
				),
		),
	]);
	return {
		members,
		inviteLinks,
		installations,
		repos: repoCount,
		ruleConfigs: rules,
		workflows,
		note: "event history retained; repos soft-removed",
	};
}

/**
 * Delete a team org. Personal orgs refuse entirely (§1/§5); the typed-name
 * confirmation is verified by the CALLING server fn (it has the user's input)
 * — this service is the data-layer cascade. FK cascades drop members, invite
 * links, and installation claims; repos are soft-removed with org_id cleared;
 * event history is append-only and stays.
 */
export async function deleteOrganization(
	db: Db,
	orgId: string,
): Promise<{ deleted: boolean }> {
	return await db.transaction(async (tx) => {
		const orgRows = await tx
			.select({ isPersonal: organization.isPersonal })
			.from(organization)
			.where(eq(organization.id, orgId))
			.limit(1);
		if (!orgRows[0]) {
			return { deleted: false };
		}
		if (orgRows[0].isPersonal) {
			throw new Error("personal orgs cannot be deleted");
		}
		await tx
			.update(repos)
			.set({ orgId: null, removedAt: new Date() })
			.where(eq(repos.orgId, orgId));
		await tx.delete(organization).where(eq(organization.id, orgId));
		return { deleted: true };
	});
}

// ── org-scoped repo reads (§8: URL owns scope) ──────────────────────────

import type { RepoLite, SwitcherRepo } from "./onboarding.ts";

const ORG_REPO_LITE = {
	id: repos.id,
	forge: repos.forge,
	owner: repos.owner,
	name: repos.name,
	fullName: repos.fullName,
	private: repos.private,
	armed: repos.armed,
	backfillTotal: repos.backfillTotal,
	backfillDone: repos.backfillDone,
} as const;

/** Connected repositories are visible independently of their evaluation capability. */
export async function listOrgRepos(db: Db, orgId: string): Promise<RepoLite[]> {
	return await db
		.select(ORG_REPO_LITE)
		.from(repos)
		.where(
			and(
				eq(repos.orgId, orgId),
				isNull(repos.removedAt),
				inArray(repos.forge, [...forgeSchema.options]),
			),
		)
		.orderBy(repos.fullName);
}

/** Resolve a unique repo within an org; ambiguous names require owner/forge qualification. */
export async function getOrgRepo(
	db: Db,
	input: { orgId: string; repoName: string; owner?: string; forge?: ForgeId },
): Promise<RepoLite | null> {
	const rows = await db
		.select(ORG_REPO_LITE)
		.from(repos)
		.where(
			and(
				eq(repos.orgId, input.orgId),
				eq(repos.name, input.repoName),
				input.owner
					? or(
							and(
								eq(repos.forge, "github"),
								sql`lower(${repos.owner}) = lower(${input.owner})`,
							),
							and(
								sql`${repos.forge} <> 'github'`,
								eq(repos.owner, input.owner),
							),
						)
					: undefined,
				input.forge ? sql`${repos.forge} = ${input.forge}` : undefined,
				inArray(repos.forge, [...forgeSchema.options]),
				isNull(repos.removedAt),
			),
		)
		.orderBy(sql`${repos.installedAt} DESC`)
		.limit(2);
	return rows.length === 1 ? (rows[0] ?? null) : null;
}

/** The org switcher list — repos with triage signal, org-scoped. */
/**
 * One row of the org repo-switcher query, parsed rather than coerced. Raw sql
 * returns untyped columns, and String()/Number()/Boolean() turn a wrong column
 * into a plausible value instead of a failure.
 */
const switcherRepoRowSchema = z.object({
	id: z.string(),
	forge: forgeSchema,
	owner: z.string(),
	name: z.string(),
	fullName: z.string(),
	armed: z.boolean(),
	pendingModeration: z.number(),
	blocked24h: z.number(),
	lastActivityAt: z
		.union([z.string(), z.date()])
		.nullable()
		.transform((value) => (value ? new Date(value).toISOString() : null)),
});

export async function listOrgSwitcherRepos(
	db: Db,
	orgId: string,
): Promise<SwitcherRepo[]> {
	const result = await db.execute(sql`
		SELECT r.id, r.forge, r.owner, r.name, r.full_name AS "fullName", r.armed,
		       COALESCE(pend.n, 0)::int AS "pendingModeration",
		       COALESCE(blk.n, 0)::int AS "blocked24h",
		       act.last AS "lastActivityAt"
		FROM repos r
		LEFT JOIN (
		  SELECT e.forge, run.repo_full_name AS repo, count(*) AS n
		  FROM moderation_items mi JOIN runs run ON run.id = mi.run_id
          JOIN events e ON e.id = run.event_id
		  WHERE mi.status = 'pending' GROUP BY e.forge, run.repo_full_name
		) pend ON pend.forge = r.forge AND pend.repo = r.full_name
		LEFT JOIN (
		  SELECT e.forge, runs.repo_full_name AS repo, count(*) AS n FROM runs
          JOIN events e ON e.id = runs.event_id
		  WHERE verdict IN ('block', 'changes_required', 'close') AND created_at > now() - make_interval(hours => 24)
		    AND ${runBearsVerdict}
		  GROUP BY e.forge, runs.repo_full_name
        ) blk ON blk.forge = r.forge AND blk.repo = r.full_name
		LEFT JOIN (
		  SELECT forge, repo_full_name AS repo, max(received_at) AS last
		  FROM events GROUP BY forge, repo_full_name
		) act ON act.forge = r.forge AND act.repo = r.full_name
		WHERE r.removed_at IS NULL AND r.org_id = ${orgId}
		ORDER BY act.last DESC NULLS LAST, r.full_name
	`);
	/** Unknown stored forge IDs are excluded without relabeling their repositories. */
	return result.rows.flatMap((row) => {
		const parsed = switcherRepoRowSchema.safeParse(row);
		return parsed.success ? [parsed.data] : [];
	});
}

export interface OrgInstallState {
	hasInstallation: boolean;
	repos: RepoLite[];
}

/** What $org/home needs: does the org have an install, and its repos. */
export async function getOrgInstallState(
	db: Db,
	orgId: string,
): Promise<OrgInstallState> {
	const installs = await db
		.select({ id: organizationInstallations.id })
		.from(organizationInstallations)
		.where(eq(organizationInstallations.organizationId, orgId))
		.limit(1);
	return {
		hasInstallation: installs.length > 0,
		repos: await listOrgRepos(db, orgId),
	};
}

export async function setOrgTimezone(
	db: Db,
	input: { orgId: string; timezone: string | null },
): Promise<void> {
	await db
		.update(organization)
		.set({ timezone: input.timezone })
		.where(eq(organization.id, input.orgId));
}
