import type { AccessStatus } from "@tripwire/contracts";
import { and, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { user } from "../schema/auth.ts";
import { member, organization } from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";

/**
 * Staff-scoped list queries for the /admin portal. Reads only — every
 * mutation the portal performs goes through the existing paths
 * (promoteUserAccess / rejectUserAccess / the membership plugin endpoint).
 * All lists are paginated with a server-side clamp; no unbounded selects.
 */

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

function clampPage(input: { limit?: number; offset?: number }): {
	limit: number;
	offset: number;
} {
	const limit = Math.min(
		Math.max(1, Math.floor(input.limit ?? DEFAULT_PAGE_SIZE)),
		MAX_PAGE_SIZE,
	);
	const offset = Math.max(0, Math.floor(input.offset ?? 0));
	return { limit, offset };
}

export interface StaffUserRow {
	id: string;
	name: string;
	email: string;
	image: string | null;
	accessStatus: AccessStatus;
	accessReviewedAt: Date | null;
	accessReviewedBy: string | null;
	isPlatformAdmin: boolean;
	/** Staff flag: skip the global re-run cooldown window. */
	rerunCooldownExempt: boolean;
	createdAt: Date;
	personalOrgSlug: string | null;
	membershipCount: number;
}

export interface StaffUserList {
	users: StaffUserRow[];
	total: number;
}

export async function listUsersForStaff(
	db: Db,
	input: {
		status?: AccessStatus;
		search?: string;
		limit?: number;
		offset?: number;
	},
): Promise<StaffUserList> {
	const { limit, offset } = clampPage(input);
	const search = input.search?.trim();
	const where = and(
		input.status ? eq(user.accessStatus, input.status) : undefined,
		search
			? or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))
			: undefined,
	);
	const personalOrgSlug = db
		.select({ slug: organization.slug })
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(and(eq(member.userId, user.id), eq(organization.isPersonal, true)))
		.limit(1);
	const membershipCount = db
		.select({ n: count() })
		.from(member)
		.where(eq(member.userId, user.id));
	const [rows, totals] = await Promise.all([
		db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				image: user.image,
				accessStatus: user.accessStatus,
				accessReviewedAt: user.accessReviewedAt,
				accessReviewedBy: user.accessReviewedBy,
				isPlatformAdmin: user.isPlatformAdmin,
				rerunCooldownExempt: user.rerunCooldownExempt,
				createdAt: user.createdAt,
				personalOrgSlug: sql<string | null>`(${personalOrgSlug})`,
				membershipCount: sql<number>`(${membershipCount})::int`,
			})
			.from(user)
			.where(where)
			.orderBy(sql`${user.createdAt} desc`)
			.limit(limit)
			.offset(offset),
		db.select({ n: count() }).from(user).where(where),
	]);
	return { users: rows, total: totals[0]?.n ?? 0 };
}

/**
 * Staff flag write: re-run cooldown exemption. Server-only; the /admin portal
 * is the only caller. Idempotent — setting the same value is a no-op.
 */
export async function setRerunCooldownExempt(
	db: Db,
	input: { userId: string; exempt: boolean },
): Promise<{ changed: boolean }> {
	const updated = await db
		.update(user)
		.set({
			rerunCooldownExempt: input.exempt,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(user.id, input.userId),
				// Only write when the value actually flips — keeps the toast honest.
				eq(user.rerunCooldownExempt, !input.exempt),
			),
		)
		.returning({ id: user.id });
	return { changed: updated.length > 0 };
}

/** Read the re-run cooldown exempt flag for the acting user (enqueue path). */
export async function isRerunCooldownExempt(
	db: Db,
	userId: string,
): Promise<boolean> {
	const rows = await db
		.select({ exempt: user.rerunCooldownExempt })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return rows[0]?.exempt ?? false;
}

export interface StaffOrgRow {
	id: string;
	name: string;
	slug: string;
	avatarHue: number | null;
	isPersonal: boolean;
	createdAt: Date;
	memberCount: number;
	repoCount: number;
}

export interface StaffOrgList {
	orgs: StaffOrgRow[];
	total: number;
}

export async function listOrgsForStaff(
	db: Db,
	input: {
		search?: string;
		kind?: "personal" | "team";
		limit?: number;
		offset?: number;
	},
): Promise<StaffOrgList> {
	const { limit, offset } = clampPage(input);
	const search = input.search?.trim();
	const where = and(
		input.kind
			? eq(organization.isPersonal, input.kind === "personal")
			: undefined,
		search
			? or(
					ilike(organization.name, `%${search}%`),
					ilike(organization.slug, `%${search}%`),
				)
			: undefined,
	);
	const memberCount = db
		.select({ n: count() })
		.from(member)
		.where(eq(member.organizationId, organization.id));
	const repoCount = db
		.select({ n: count() })
		.from(repos)
		.where(and(eq(repos.orgId, organization.id), isNull(repos.removedAt)));
	const [rows, totals] = await Promise.all([
		db
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				avatarHue: organization.avatarHue,
				isPersonal: organization.isPersonal,
				createdAt: organization.createdAt,
				memberCount: sql<number>`(${memberCount})::int`,
				repoCount: sql<number>`(${repoCount})::int`,
			})
			.from(organization)
			.where(where)
			.orderBy(sql`${organization.createdAt} desc`)
			.limit(limit)
			.offset(offset),
		db.select({ n: count() }).from(organization).where(where),
	]);
	return { orgs: rows, total: totals[0]?.n ?? 0 };
}

export interface StaffOrgMemberRow {
	memberId: string;
	userId: string;
	name: string;
	email: string;
	image: string | null;
	role: string;
	joinedAt: Date;
}

export async function listOrgMembersForStaff(
	db: Db,
	orgId: string,
): Promise<StaffOrgMemberRow[]> {
	return db
		.select({
			memberId: member.id,
			userId: member.userId,
			name: user.name,
			email: user.email,
			image: user.image,
			role: member.role,
			joinedAt: member.createdAt,
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, orgId))
		.orderBy(member.createdAt);
}

export interface StaffOverview {
	pendingUsers: number;
	approvedUsers: number;
	rejectedUsers: number;
	orgs: number;
	repos: number;
}

export async function getStaffOverview(db: Db): Promise<StaffOverview> {
	const [byStatus, orgTotals, repoTotals] = await Promise.all([
		db
			.select({ status: user.accessStatus, n: count() })
			.from(user)
			.groupBy(user.accessStatus),
		db.select({ n: count() }).from(organization),
		db.select({ n: count() }).from(repos).where(isNull(repos.removedAt)),
	]);
	const statusCount = (status: AccessStatus) =>
		byStatus.find((row) => row.status === status)?.n ?? 0;
	return {
		pendingUsers: statusCount("pending"),
		approvedUsers: statusCount("approved"),
		rejectedUsers: statusCount("rejected"),
		orgs: orgTotals[0]?.n ?? 0,
		repos: repoTotals[0]?.n ?? 0,
	};
}
