import { createHash, randomBytes } from "node:crypto";
import {
	type OrgRole,
	orgSlugSchema,
	slugifyOrgName,
	suffixSlug,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { user } from "../schema/auth.ts";
import {
	member,
	organization,
	organizationInstallations,
	organizationInviteLinks,
} from "../schema/organizations.ts";
import { repos, ruleConfigs, workflowDefinitions } from "../schema/repos.ts";
import { promoteUserAccess } from "./access.ts";

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
}

export interface OrgWithRole extends OrgSummary {
	role: OrgRole;
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
			role: member.role,
		})
		.from(organization)
		.innerJoin(member, eq(member.organizationId, organization.id))
		.where(
			and(eq(organization.slug, input.slug), eq(member.userId, input.userId)),
		)
		.limit(1);
	const row = rows[0];
	return row ? { ...row, role: row.role as OrgRole } : null;
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
			role: member.role,
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, userId))
		.orderBy(sql`${organization.isPersonal} DESC, ${organization.name}`);
	return rows.map((r) => ({ ...r, role: r.role as OrgRole }));
}

/** The caller's role in an org, fresh from the DB (never from session). */
export async function getMemberRole(
	db: Db,
	input: { orgId: string; userId: string },
): Promise<OrgRole | null> {
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
	return (rows[0]?.role as OrgRole) ?? null;
}

export async function countAdmins(db: Db, orgId: string): Promise<number> {
	const rows = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.role, "admin")));
	return rows[0]?.n ?? 0;
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
		forge?: string;
		accountType?: string;
		accountLogin?: string;
	},
): Promise<{ claimed: boolean }> {
	const forge = input.forge ?? "github";
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
		forge?: string;
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
	input: { installationId: string; toOrgId: string; forge?: string },
): Promise<{ moved: boolean }> {
	const forge = input.forge ?? "github";
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
	input: { installationId: string; forge?: string },
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
