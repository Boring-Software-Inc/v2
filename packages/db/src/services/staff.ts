import {
	type AccessStatus,
	type Forge,
	forgeSchema,
} from "@tripwire/contracts";
import {
	and,
	count,
	eq,
	gt,
	ilike,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";
import type { Db } from "../client.ts";
import { user } from "../schema/auth.ts";
import {
	member,
	organization,
	organizationInstallations,
} from "../schema/organizations.ts";
import { repos } from "../schema/repos.ts";
import { runs } from "../schema/runs.ts";

/**
 * Staff-scoped list queries for the /admin portal. Reads only — every
 * mutation the portal performs goes through the existing paths
 * (promoteUserAccess / rejectUserAccess / the membership plugin endpoint).
 * All lists are paginated with a server-side clamp; no unbounded selects.
 */

const lastDay = sql`now() - interval '24 hours'`;
const onlineWindow = sql`now() - interval '5 minutes'`;

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
	lastSeenAt: Date | null;
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
		online?: boolean;
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
		input.online ? gt(user.lastSeenAt, onlineWindow) : undefined,
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
				lastSeenAt: user.lastSeenAt,
				personalOrgSlug: sql<string | null>`(${personalOrgSlug})`,
				membershipCount: sql<number>`(${membershipCount})::int`,
			})
			.from(user)
			.where(where)
			.orderBy(
				input.online
					? sql`${user.lastSeenAt} desc`
					: sql`${user.createdAt} desc`,
			)
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
	totalUsers: number;
	onlineUsers: number;
	activeUsersToday: number;
	orgs: number;
	teamOrgs: number;
	personalOrgs: number;
	repos: number;
	protectedRepos: number;
	installations: number;
	runsLastDay: number;
	blockedChangeRequestsLastDay: number;
}

function liveInstallations(db: Db) {
	return union(
		db
			.select({
				forge: sql<string>`${organizationInstallations.forge}`.as("forge"),
				installationId:
					sql<string>`${organizationInstallations.installationId}`.as(
						"installation_id",
					),
			})
			.from(organizationInstallations),
		db
			.select({
				forge: sql<string>`${repos.forge}`.as("forge"),
				installationId: sql<string>`${repos.installationId}`.as(
					"installation_id",
				),
			})
			.from(repos)
			.where(and(isNull(repos.removedAt), isNotNull(repos.installationId))),
	).as("live_installations");
}

export async function getStaffOverview(db: Db): Promise<StaffOverview> {
	const live = liveInstallations(db);
	const [
		byStatus,
		orgsByKind,
		repoTotals,
		installationTotals,
		presenceTotals,
		runTotals,
	] = await Promise.all([
		db
			.select({ status: user.accessStatus, n: count() })
			.from(user)
			.groupBy(user.accessStatus),
		db
			.select({ isPersonal: organization.isPersonal, n: count() })
			.from(organization)
			.groupBy(organization.isPersonal),
		db
			.select({
				total: count(),
				protectedTotal: count(sql`case when ${repos.armed} then 1 end`),
			})
			.from(repos)
			.where(isNull(repos.removedAt)),
		db.select({ n: count() }).from(live),
		db
			.select({
				online: count(
					sql`case when ${user.lastSeenAt} > ${onlineWindow} then 1 end`,
				),
				today: count(),
			})
			.from(user)
			.where(gt(user.lastSeenAt, lastDay)),
		db
			.select({
				total: count(),
				blocked:
					sql<number>`count(distinct (${runs.repoFullName}, ${runs.subjectNumber})) filter (where ${runs.verdict} = 'block' and ${runs.subjectNumber} is not null)`.mapWith(
						Number,
					),
			})
			.from(runs)
			.where(gt(runs.createdAt, lastDay)),
	]);
	const statusCount = (status: AccessStatus) =>
		byStatus.find((row) => row.status === status)?.n ?? 0;
	const orgCount = (isPersonal: boolean) =>
		orgsByKind.find((row) => row.isPersonal === isPersonal)?.n ?? 0;
	return {
		pendingUsers: statusCount("pending"),
		approvedUsers: statusCount("approved"),
		rejectedUsers: statusCount("rejected"),
		totalUsers: byStatus.reduce((sum, row) => sum + row.n, 0),
		onlineUsers: presenceTotals[0]?.online ?? 0,
		activeUsersToday: presenceTotals[0]?.today ?? 0,
		orgs: orgCount(true) + orgCount(false),
		teamOrgs: orgCount(false),
		personalOrgs: orgCount(true),
		repos: repoTotals[0]?.total ?? 0,
		protectedRepos: repoTotals[0]?.protectedTotal ?? 0,
		installations: installationTotals[0]?.n ?? 0,
		runsLastDay: runTotals[0]?.total ?? 0,
		blockedChangeRequestsLastDay: runTotals[0]?.blocked ?? 0,
	};
}

export interface StaffRepoRow {
	id: string;
	forge: Forge;
	fullName: string;
	protected: boolean;
	installedAt: Date;
	orgName: string | null;
	orgSlug: string | null;
}

export interface StaffRepoList {
	repos: StaffRepoRow[];
	total: number;
}

export async function listReposForStaff(
	db: Db,
	input: {
		status?: "protected" | "unprotected";
		search?: string;
		limit?: number;
		offset?: number;
	},
): Promise<StaffRepoList> {
	const { limit, offset } = clampPage(input);
	const search = input.search?.trim();
	const where = and(
		isNull(repos.removedAt),
		input.status ? eq(repos.armed, input.status === "protected") : undefined,
		search ? ilike(repos.fullName, `%${search}%`) : undefined,
	);
	const [rows, totals] = await Promise.all([
		db
			.select({
				id: repos.id,
				forge: repos.forge,
				fullName: repos.fullName,
				protected: repos.armed,
				installedAt: repos.installedAt,
				orgName: organization.name,
				orgSlug: organization.slug,
			})
			.from(repos)
			.leftJoin(organization, eq(repos.orgId, organization.id))
			.where(where)
			.orderBy(sql`${repos.installedAt} desc`, repos.fullName)
			.limit(limit)
			.offset(offset),
		db.select({ n: count() }).from(repos).where(where),
	]);
	return { repos: rows, total: totals[0]?.n ?? 0 };
}

export interface StaffInstallationRow {
	forge: Forge;
	installationId: string;
	accountLogin: string | null;
	accountType: string | null;
	orgName: string | null;
	orgSlug: string | null;
	repoCount: number;
	protectedRepoCount: number;
}

export interface StaffInstallationList {
	installations: StaffInstallationRow[];
	total: number;
}

const liveForge = sql<string>`"live_installations"."forge"`;
const liveInstallationId = sql<string>`"live_installations"."installation_id"`;

export async function listInstallationsForStaff(
	db: Db,
	input: { limit?: number; offset?: number },
): Promise<StaffInstallationList> {
	const { limit, offset } = clampPage(input);
	const live = liveInstallations(db);
	const liveRepos = and(
		eq(repos.forge, liveForge),
		eq(repos.installationId, liveInstallationId),
		isNull(repos.removedAt),
	);
	const repoCount = db.select({ n: count() }).from(repos).where(liveRepos);
	const protectedRepoCount = db
		.select({ n: count() })
		.from(repos)
		.where(and(liveRepos, eq(repos.armed, true)));
	const repoOwner = db
		.select({ owner: sql`min(${repos.owner})` })
		.from(repos)
		.where(liveRepos);
	const [rows, totals] = await Promise.all([
		db
			.select({
				forge: liveForge,
				installationId: liveInstallationId,
				accountLogin: sql<
					string | null
				>`coalesce(${organizationInstallations.accountLogin}, (${repoOwner}))`,
				accountType: organizationInstallations.accountType,
				orgName: organization.name,
				orgSlug: organization.slug,
				repoCount: sql<number>`(${repoCount})::int`,
				protectedRepoCount: sql<number>`(${protectedRepoCount})::int`,
			})
			.from(live)
			.leftJoin(
				organizationInstallations,
				and(
					eq(organizationInstallations.forge, liveForge),
					eq(organizationInstallations.installationId, liveInstallationId),
				),
			)
			.leftJoin(
				organization,
				eq(organizationInstallations.organizationId, organization.id),
			)
			.orderBy(sql`${organization.name} nulls last`, liveInstallationId)
			.limit(limit)
			.offset(offset),
		db.select({ n: count() }).from(live),
	]);
	return {
		installations: rows.map((row) => ({
			...row,
			forge: forgeSchema.parse(row.forge),
		})),
		total: totals[0]?.n ?? 0,
	};
}
